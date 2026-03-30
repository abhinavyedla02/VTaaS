import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    GetObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';

export interface ObjectMetadata {
    size: number;
    contentType: string;
}

@Injectable()
export class WorkerS3Service implements OnModuleInit {
    private readonly logger = new Logger(WorkerS3Service.name);
    private readonly client: S3Client;
    private readonly inputBucket: string;
    private readonly outputBucket: string;

    constructor() {
        const endpoint = process.env.AWS_ENDPOINT_URL;
        const region = process.env.AWS_REGION || 'us-east-1';

        this.inputBucket = process.env.S3_INPUT_BUCKET || 'vtaas-inputs';
        this.outputBucket = process.env.S3_OUTPUT_BUCKET || 'vtaas-outputs';

        this.client = new S3Client({
            ...(endpoint ? { endpoint } : {}),
            region,
            ...(endpoint ? { forcePathStyle: true } : {}),
            ...(endpoint
                ? { credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
                : {}),
        });
    }

    async onModuleInit(): Promise<void> {
        // Only create/verify bucket on LocalStack. In production the bucket
        // is provisioned by the infra script and the task role has no CreateBucket perm.
        if (process.env.AWS_ENDPOINT_URL) {
            await this.ensureOutputBucketExists();
        }
    }

    private async ensureOutputBucketExists(): Promise<void> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.outputBucket }));
            this.logger.log(`S3 bucket ${this.outputBucket} already exists`);
        } catch (error: unknown) {
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === 'NotFound' || s3Error.$metadata?.httpStatusCode === 404) {
                this.logger.log(`Creating S3 bucket ${this.outputBucket}...`);
                await this.client.send(new CreateBucketCommand({ Bucket: this.outputBucket }));
                this.logger.log(`S3 bucket ${this.outputBucket} initialized`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Download an object from S3.
     */
    async getObject(bucket: string, key: string): Promise<Buffer> {
        const response = await this.client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const bytes = await response.Body!.transformToByteArray();
        return Buffer.from(bytes);
    }

    /**
     * Upload an object to S3.
     */
    async putObject(
        bucket: string,
        key: string,
        body: Buffer,
        contentType: string,
    ): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
            }),
        );
        this.logger.log(`Uploaded s3://${bucket}/${key} (${body.length} bytes)`);
    }

    /**
     * Check if an object exists in S3.
     * Returns metadata if found, null if not found.
     * Unlike the API's S3Service, this does NOT throw on 404 —
     * "not found" is the expected happy path for dedupe checks.
     */
    async headObject(bucket: string, key: string): Promise<ObjectMetadata | null> {
        try {
            const response = await this.client.send(
                new HeadObjectCommand({ Bucket: bucket, Key: key }),
            );
            return {
                size: response.ContentLength ?? 0,
                contentType: response.ContentType ?? 'unknown',
            };
        } catch (error: unknown) {
            const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Error.name === 'NotFound' || s3Error.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw error;
        }
    }

    /** Expose for testing */
    getClient(): S3Client {
        return this.client;
    }

    getInputBucket(): string {
        return this.inputBucket;
    }

    getOutputBucket(): string {
        return this.outputBucket;
    }
}
