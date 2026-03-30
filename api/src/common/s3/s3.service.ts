import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    PutBucketCorsCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DomainException } from '../exceptions';

export interface ObjectMetadata {
    size: number;
    contentType: string;
}

@Injectable()
export class S3Service implements OnModuleInit {
    private readonly logger = new Logger(S3Service.name);
    private client: S3Client;
    private readonly bucket: string;
    private readonly outputBucket: string;

    constructor() {
        const endpoint = process.env.AWS_ENDPOINT_URL;
        const region = process.env.AWS_REGION || 'us-east-1';

        this.bucket = process.env.S3_INPUT_BUCKET || 'vtaas-inputs';
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
            await this.ensureBucketExists();
        }
    }

    private async ensureBucketExists(): Promise<void> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
            this.logger.log(`S3 bucket ${this.bucket} already exists`);
        } catch (error: any) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                this.logger.log(`Creating S3 bucket ${this.bucket}...`);
                await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
                await this.applyCorsRules();
                this.logger.log(`S3 bucket ${this.bucket} initialized`);
            } else {
                throw error;
            }
        }
    }

    private async applyCorsRules(): Promise<void> {
        const originsEnv = process.env.CORS_ALLOWED_ORIGINS;
        const allowedOrigins = originsEnv
            ? originsEnv.split(',').map((o) => o.trim())
            : ['*'];

        await this.client.send(
            new PutBucketCorsCommand({
                Bucket: this.bucket,
                CORSConfiguration: {
                    CORSRules: [
                        {
                            AllowedHeaders: ['*'],
                            AllowedMethods: ['PUT', 'GET', 'HEAD'],
                            AllowedOrigins: allowedOrigins,
                            ExposeHeaders: ['ETag'],
                            MaxAgeSeconds: 3600,
                        },
                    ],
                },
            }),
        );
        this.logger.log(`CORS rules applied to ${this.bucket} (origins: ${allowedOrigins.join(', ')})`);
    }

    async getPresignedPutUrl(
        key: string,
        contentType: string,
        expiresIn: number,
    ): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });

        return getSignedUrl(this.client, command, { expiresIn });
    }

    async headObject(key: string): Promise<ObjectMetadata> {
        try {
            const response = await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
            );
            return {
                size: response.ContentLength ?? 0,
                contentType: response.ContentType ?? 'unknown',
            };
        } catch (error: any) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                throw new DomainException(
                    'OBJECT_NOT_FOUND',
                    `Object '${key}' not found in S3`,
                );
            }
            throw error;
        }
    }

    async getDownloadUrl(
        bucket: string,
        key: string,
        expiresIn = 3600,
    ): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });

        return getSignedUrl(this.client, command, { expiresIn });
    }

    // Expose client for testing
    getClient(): S3Client {
        return this.client;
    }

    getBucket(): string {
        return this.bucket;
    }

    getOutputBucket(): string {
        return this.outputBucket;
    }

    async deleteObject(bucket: string, key: string): Promise<void> {
        try {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }),
            );
            this.logger.log(`Deleted s3://${bucket}/${key}`);
        } catch (error: unknown) {
            const s3Error = error as { 
                name?: string; 
                $metadata?: { httpStatusCode?: number };
                message?: string;
            };
            if (
                s3Error.name === 'NoSuchKey' ||
                s3Error.name === 'NotFound' ||
                s3Error.$metadata?.httpStatusCode === 404
            ) {
                this.logger.log(`Skipped missing object: s3://${bucket}/${key}`);
                return;
            }
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to delete s3://${bucket}/${key}: ${msg}`);
            throw error;
        }
    }
}
