import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import {
    SQSClient,
    GetQueueUrlCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { TranscodePayload } from './types';
import { TranscodeService } from '../transcode/transcode.service';

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SqsConsumerService.name);
    private readonly client: SQSClient;
    private readonly queueName: string;
    private queueUrl!: string;
    private isPolling = false;

    constructor(private readonly transcodeService: TranscodeService) {
        const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localstack:4566';
        const region = process.env.AWS_REGION || 'us-east-1';

        this.queueName = process.env.SQS_QUEUE_NAME || 'transcode-jobs';

        this.client = new SQSClient({
            endpoint,
            region,
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        });
    }

    async onModuleInit(): Promise<void> {
        const result = await this.client.send(
            new GetQueueUrlCommand({ QueueName: this.queueName }),
        );
        this.queueUrl = result.QueueUrl!;
        this.logger.log(`Queue URL resolved: ${this.queueUrl}`);

        this.isPolling = true;

        // intentional fire-and-forget — polling loop must not block module init
        void this.startPolling();
    }

    async onModuleDestroy(): Promise<void> {
        this.isPolling = false;
        this.logger.log('SQS consumer stopped');
    }

    private async startPolling(): Promise<void> {
        this.logger.log('Polling SQS...');
        while (this.isPolling) {
            await this.poll();
        }
    }

    private async poll(): Promise<void> {
        try {
            const response = await this.client.send(
                new ReceiveMessageCommand({
                    QueueUrl: this.queueUrl,
                    WaitTimeSeconds: 20,
                    MaxNumberOfMessages: 1,
                }),
            );

            if (!response.Messages || response.Messages.length === 0) {
                return;
            }

            const message = response.Messages[0];
            const payload = JSON.parse(message.Body!) as TranscodePayload;

            try {
                await this.handlePayload(payload, message.ReceiptHandle!);

                await this.client.send(
                    new DeleteMessageCommand({
                        QueueUrl: this.queueUrl,
                        ReceiptHandle: message.ReceiptHandle!,
                    }),
                );
                this.logger.log(`Deleted message for job ${payload.jobId}`);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                this.logger.error(
                    `Failed to process job ${payload.jobId}: ${msg} — message will retry after VisibilityTimeout`,
                );
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Poll error: ${msg}`);
        }
    }

    /**
     * Handle a single transcode job payload.
     * Delegates to TranscodeService for the full pipeline.
     * _receiptHandle kept for Phase 2 visibility extension (Issue 11).
     */
    async handlePayload(payload: TranscodePayload, _receiptHandle: string): Promise<void> {
        await this.transcodeService.processJob(payload);
    }

    /** Expose for testing */
    getClient(): SQSClient {
        return this.client;
    }
}
