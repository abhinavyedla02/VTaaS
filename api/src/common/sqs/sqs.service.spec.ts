import { SqsService } from './sqs.service';
import {
    SQSClient,
    CreateQueueCommand,
    GetQueueAttributesCommand,
    SendMessageCommand,
} from '@aws-sdk/client-sqs';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sqs', () => {
    const actual = jest.requireActual('@aws-sdk/client-sqs');
    return {
        ...actual,
        SQSClient: jest.fn().mockImplementation(() => ({
            send: jest.fn(),
        })),
    };
});

describe('SqsService', () => {
    let service: SqsService;
    let mockSend: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        // onModuleInit create-queue path only runs when AWS_ENDPOINT_URL is set
        process.env.AWS_ENDPOINT_URL = 'http://localstack:4566';
        service = new SqsService();
        mockSend = service.getClient().send as jest.Mock;
    });

    afterEach(() => {
        delete process.env.AWS_ENDPOINT_URL;
    });

    describe('onModuleInit', () => {
        it('should create DLQ, get its ARN, and create main queue with RedrivePolicy and VisibilityTimeout', async () => {
            mockSend
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs-dlq',
                }) // CreateQueue (DLQ)
                .mockResolvedValueOnce({
                    Attributes: {
                        QueueArn: 'arn:aws:sqs:us-east-1:000000000000:transcode-jobs-dlq',
                    },
                }) // GetQueueAttributes (DLQ ARN)
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs',
                }); // CreateQueue (main)

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(3);

            // 1. Create DLQ
            expect(mockSend).toHaveBeenNthCalledWith(
                1,
                expect.any(CreateQueueCommand),
            );
            const dlqCall = mockSend.mock.calls[0][0];
            expect(dlqCall.input.QueueName).toBe('transcode-jobs-dlq');

            // 2. Get DLQ ARN
            expect(mockSend).toHaveBeenNthCalledWith(
                2,
                expect.any(GetQueueAttributesCommand),
            );
            const getAttrsCall = mockSend.mock.calls[1][0];
            expect(getAttrsCall.input.QueueUrl).toBe(
                'http://localhost:4566/000000000000/transcode-jobs-dlq',
            );
            expect(getAttrsCall.input.AttributeNames).toEqual(['QueueArn']);

            // 3. Create main queue with RedrivePolicy and VisibilityTimeout
            const mainCall = mockSend.mock.calls[2][0];
            expect(mainCall.input.QueueName).toBe('transcode-jobs');
            const redrivePolicy = JSON.parse(mainCall.input.Attributes.RedrivePolicy);
            expect(redrivePolicy).toEqual({
                deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:transcode-jobs-dlq',
                maxReceiveCount: '3',
            });
            expect(mainCall.input.Attributes.VisibilityTimeout).toBe('300');
        });

        it('should cache the main queue URL after initialization', async () => {
            mockSend
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs-dlq',
                })
                .mockResolvedValueOnce({
                    Attributes: {
                        QueueArn: 'arn:aws:sqs:us-east-1:000000000000:transcode-jobs-dlq',
                    },
                })
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs',
                });

            await service.onModuleInit();

            expect(service.getQueueUrl()).toBe(
                'http://localhost:4566/000000000000/transcode-jobs',
            );
        });

        it('should rethrow unexpected errors during DLQ creation', async () => {
            const unexpectedError = new Error('Connection refused');
            mockSend.mockRejectedValueOnce(unexpectedError);

            await expect(service.onModuleInit()).rejects.toThrow('Connection refused');
        });

        it('should rethrow unexpected errors during main queue creation', async () => {
            mockSend
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs-dlq',
                })
                .mockResolvedValueOnce({
                    Attributes: {
                        QueueArn: 'arn:aws:sqs:us-east-1:000000000000:transcode-jobs-dlq',
                    },
                })
                .mockRejectedValueOnce(new Error('Access denied'));

            await expect(service.onModuleInit()).rejects.toThrow('Access denied');
        });
    });

    describe('getQueueUrl', () => {
        it('should return undefined before initialization', () => {
            expect(service.getQueueUrl()).toBeUndefined();
        });
    });

    describe('enqueueTranscode', () => {
        const testPayload = {
            jobId: 'test-job-id-123',
            inputKey: 'inputs/test-uuid.mp4',
            profiles: ['720p'],
        };

        beforeEach(async () => {
            // Initialize queues so queueUrl is cached
            mockSend
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs-dlq',
                })
                .mockResolvedValueOnce({
                    Attributes: {
                        QueueArn: 'arn:aws:sqs:us-east-1:000000000000:transcode-jobs-dlq',
                    },
                })
                .mockResolvedValueOnce({
                    QueueUrl: 'http://localhost:4566/000000000000/transcode-jobs',
                });
            await service.onModuleInit();
            mockSend.mockClear();
        });

        it('should send a message with correct QueueUrl and serialized payload', async () => {
            mockSend.mockResolvedValueOnce({});

            await service.enqueueTranscode(testPayload);

            expect(mockSend).toHaveBeenCalledTimes(1);
            expect(mockSend).toHaveBeenCalledWith(expect.any(SendMessageCommand));

            const sentCommand = mockSend.mock.calls[0][0];
            expect(sentCommand.input.QueueUrl).toBe(
                'http://localhost:4566/000000000000/transcode-jobs',
            );
        });

        it('should serialize payload matching D-007 schema', async () => {
            mockSend.mockResolvedValueOnce({});

            await service.enqueueTranscode(testPayload);

            const sentCommand = mockSend.mock.calls[0][0];
            const body = JSON.parse(sentCommand.input.MessageBody);
            expect(body).toEqual({
                jobId: 'test-job-id-123',
                inputKey: 'inputs/test-uuid.mp4',
                profiles: ['720p'],
            });
        });

        it('should rethrow errors from SQS send', async () => {
            mockSend.mockRejectedValueOnce(new Error('SQS unavailable'));

            await expect(service.enqueueTranscode(testPayload))
                .rejects.toThrow('SQS unavailable');
        });
    });
});
