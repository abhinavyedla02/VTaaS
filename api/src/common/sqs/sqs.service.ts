import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
    SQSClient,
    CreateQueueCommand,
    GetQueueAttributesCommand,
    SendMessageCommand,
} from '@aws-sdk/client-sqs';

export interface TranscodePayload {
    jobId: string;       // UUID from DB
    inputKey: string;    // e.g. "inputs/abc123.mp4"
    profiles: string[];  // e.g. ["720p"] — locked per D-007
}

@Injectable()
export class SqsService implements OnModuleInit {
    private readonly logger = new Logger(SqsService.name);
    private client: SQSClient;
    private queueUrl!: string;

    private readonly queueName: string;
    private readonly dlqName: string;
    private readonly maxReceiveCount: string;
    private readonly visibilityTimeout: string;

    constructor() {
        const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localstack:4566';
        const region = process.env.AWS_REGION || 'us-east-1';

        this.queueName = process.env.SQS_QUEUE_NAME || 'transcode-jobs';
        this.dlqName = process.env.SQS_DLQ_NAME || 'transcode-jobs-dlq';
        this.maxReceiveCount = process.env.SQS_MAX_RECEIVE_COUNT || '3';
        this.visibilityTimeout = '300'; // 5 minutes — video processing needs time

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
        await this.ensureQueuesExist();
    }

    private async ensureQueuesExist(): Promise<void> {
        // 1. Create DLQ first (idempotent — returns existing URL if queue exists)
        const dlqResult = await this.client.send(
            new CreateQueueCommand({ QueueName: this.dlqName }),
        );
        const dlqUrl = dlqResult.QueueUrl!;
        this.logger.log(`DLQ ready: ${this.dlqName}`);

        // 2. Get DLQ ARN (needed for RedrivePolicy)
        const dlqAttrs = await this.client.send(
            new GetQueueAttributesCommand({
                QueueUrl: dlqUrl,
                AttributeNames: ['QueueArn'],
            }),
        );
        const dlqArn = dlqAttrs.Attributes!['QueueArn'];

        // 3. Create main queue with RedrivePolicy + VisibilityTimeout
        const mainResult = await this.client.send(
            new CreateQueueCommand({
                QueueName: this.queueName,
                Attributes: {
                    RedrivePolicy: JSON.stringify({
                        deadLetterTargetArn: dlqArn,
                        maxReceiveCount: this.maxReceiveCount,
                    }),
                    VisibilityTimeout: this.visibilityTimeout,
                },
            }),
        );
        this.queueUrl = mainResult.QueueUrl!;
        this.logger.log(
            `Queue initialized: ${this.queueName} (DLQ: ${this.dlqName}, VisibilityTimeout: ${this.visibilityTimeout}s)`,
        );
    }

    async enqueueTranscode(payload: TranscodePayload): Promise<void> {
        await this.client.send(
            new SendMessageCommand({
                QueueUrl: this.queueUrl,
                MessageBody: JSON.stringify(payload),
            }),
        );
        this.logger.log(`Enqueued job ${payload.jobId}`);
    }

    // Expose client for testing
    getClient(): SQSClient {
        return this.client;
    }

    getQueueUrl(): string {
        return this.queueUrl;
    }
}
