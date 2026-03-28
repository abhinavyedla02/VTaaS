import { SqsConsumerService } from './sqs-consumer.service';
import {
    SQSClient,
    GetQueueUrlCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { TranscodePayload } from './types';
import { TranscodeService } from '../transcode/transcode.service';

// Mock the AWS SDK (same pattern as worker/src/s3/s3.service.spec.ts)
jest.mock('@aws-sdk/client-sqs', () => {
    const actual = jest.requireActual('@aws-sdk/client-sqs');
    return {
        ...actual,
        SQSClient: jest.fn().mockImplementation(() => ({
            send: jest.fn(),
        })),
    };
});

const MOCK_QUEUE_URL = 'http://localstack:4566/000000000000/transcode-jobs';

const mockPayload: TranscodePayload = {
    jobId: 'job-abc-123',
    inputKey: 'inputs/abc.mp4',
    profiles: ['720p'],
};

describe('SqsConsumerService', () => {
    let service: SqsConsumerService;
    let mockSend: jest.Mock;
    let mockTranscodeService: { processJob: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockTranscodeService = { processJob: jest.fn().mockResolvedValue(undefined) };
        service = new SqsConsumerService(
            mockTranscodeService as unknown as TranscodeService,
        );
        mockSend = service.getClient().send as jest.Mock;
    });

    afterEach(async () => {
        // Ensure polling loop is stopped after each test
        await service.onModuleDestroy();
    });

    describe('onModuleInit', () => {
        it('resolves queue URL on module init', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // Prevent infinite loop: empty queue, then stop
                .mockImplementation(async () => {
                    await service.onModuleDestroy();
                    return { Messages: [] };
                });

            await service.onModuleInit();

            // First call should be GetQueueUrlCommand
            expect(mockSend).toHaveBeenCalledWith(expect.any(GetQueueUrlCommand));
            const getUrlCmd = mockSend.mock.calls[0][0] as GetQueueUrlCommand;
            expect(getUrlCmd.input.QueueName).toBe('transcode-jobs');
        });

        it('starts polling loop on module init without blocking', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // Block the first ReceiveMessage so polling is "in progress"
                .mockImplementation(() => new Promise<{ Messages: never[] }>((resolve) => {
                    // Resolve after a delay — proving onModuleInit resolved first
                    setTimeout(() => {
                        void service.onModuleDestroy();
                        resolve({ Messages: [] });
                    }, 50);
                }));

            // onModuleInit should resolve immediately (fire-and-forget)
            const initPromise = service.onModuleInit();
            await expect(initPromise).resolves.toBeUndefined();

            // Wait for the delayed polling to settle
            await new Promise(resolve => setTimeout(resolve, 100));
        });
    });

    describe('poll behavior', () => {
        it('deletes message after successful handlePayload', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // ReceiveMessage returns 1 message
                .mockResolvedValueOnce({
                    Messages: [{
                        Body: JSON.stringify(mockPayload),
                        ReceiptHandle: 'receipt-123',
                    }],
                })
                // DeleteMessage succeeds
                .mockResolvedValueOnce({})
                // Next ReceiveMessage: stop polling
                .mockImplementation(async () => {
                    await service.onModuleDestroy();
                    return { Messages: [] };
                });

            await service.onModuleInit();

            // Let the fire-and-forget polling loop process one cycle
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify: DeleteMessageCommand was sent with correct receipt handle
            const deleteCalls = mockSend.mock.calls.filter(
                (call: unknown[]) => call[0] instanceof DeleteMessageCommand,
            );
            expect(deleteCalls).toHaveLength(1);
            const deleteCmd = deleteCalls[0][0] as DeleteMessageCommand;
            expect(deleteCmd.input.ReceiptHandle).toBe('receipt-123');
            expect(deleteCmd.input.QueueUrl).toBe(MOCK_QUEUE_URL);
        });

        it('does NOT delete message when handlePayload throws', async () => {
            // Make TranscodeService.processJob reject
            mockTranscodeService.processJob.mockRejectedValueOnce(
                new Error('Transcode failed'),
            );

            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // ReceiveMessage returns 1 message
                .mockResolvedValueOnce({
                    Messages: [{
                        Body: JSON.stringify(mockPayload),
                        ReceiptHandle: 'receipt-456',
                    }],
                })
                // Next ReceiveMessage: stop polling
                .mockImplementation(async () => {
                    await service.onModuleDestroy();
                    return { Messages: [] };
                });

            await service.onModuleInit();

            // Let the fire-and-forget polling loop process one cycle
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify: DeleteMessageCommand was NEVER sent
            const deleteCalls = mockSend.mock.calls.filter(
                (call: unknown[]) => call[0] instanceof DeleteMessageCommand,
            );
            expect(deleteCalls).toHaveLength(0);
        });

        it('deletes poison pill message with unparseable JSON immediately', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // ReceiveMessage returns a message with invalid JSON
                .mockResolvedValueOnce({
                    Messages: [{
                        Body: '<<<not json>>>',
                        ReceiptHandle: 'receipt-poison',
                    }],
                })
                // DeleteMessage succeeds
                .mockResolvedValueOnce({})
                // Next ReceiveMessage: stop polling
                .mockImplementation(async () => {
                    await service.onModuleDestroy();
                    return { Messages: [] };
                });

            await service.onModuleInit();

            // Let the fire-and-forget polling loop process one cycle
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify: DeleteMessageCommand was sent (poison pill deleted)
            const deleteCalls = mockSend.mock.calls.filter(
                (call: unknown[]) => call[0] instanceof DeleteMessageCommand,
            );
            expect(deleteCalls).toHaveLength(1);
            const deleteCmd = deleteCalls[0][0] as DeleteMessageCommand;
            expect(deleteCmd.input.ReceiptHandle).toBe('receipt-poison');

            // Verify: TranscodeService was NOT called
            expect(mockTranscodeService.processJob).not.toHaveBeenCalled();
        });

        it('handles empty queue response gracefully', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // ReceiveMessage returns no messages
                .mockResolvedValueOnce({ Messages: [] })
                // Stop polling on next iteration
                .mockImplementation(async () => {
                    await service.onModuleDestroy();
                    return { Messages: [] };
                });

            await service.onModuleInit();

            // Let the fire-and-forget polling loop run
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify: no errors, no DeleteMessage calls
            const deleteCalls = mockSend.mock.calls.filter(
                (call: unknown[]) => call[0] instanceof DeleteMessageCommand,
            );
            expect(deleteCalls).toHaveLength(0);

            // Verify: ReceiveMessage was called (polling happened)
            const receiveCalls = mockSend.mock.calls.filter(
                (call: unknown[]) => call[0] instanceof ReceiveMessageCommand,
            );
            expect(receiveCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('onModuleDestroy', () => {
        it('sets isPolling=false on module destroy', async () => {
            mockSend
                .mockResolvedValueOnce({ QueueUrl: MOCK_QUEUE_URL })
                // Hold polling open so we can test destroy
                .mockImplementation(() => new Promise<{ Messages: never[] }>((resolve) => {
                    setTimeout(() => resolve({ Messages: [] }), 200);
                }));

            await service.onModuleInit();

            // Destroy should complete immediately
            await service.onModuleDestroy();

            // After destroy, no more ReceiveMessage calls should be initiated
            const callCountAfterDestroy = mockSend.mock.calls.length;
            await new Promise(resolve => setTimeout(resolve, 100));
            // At most one more call may have been in-flight
            expect(mockSend.mock.calls.length).toBeLessThanOrEqual(callCountAfterDestroy + 1);
        });
    });
});
