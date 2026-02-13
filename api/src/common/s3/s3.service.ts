import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    PutBucketCorsCommand,
    PutObjectCommand,
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
    private readonly bucket = 'vtaas-inputs';

    constructor() {
        const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localstack:4566';
        const region = process.env.AWS_REGION || 'us-east-1';

        this.client = new S3Client({
            endpoint,
            region,
            forcePathStyle: true, // Required for LocalStack
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        });
    }

    async onModuleInit(): Promise<void> {
        await this.ensureBucketExists();
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
        // TODO: Move to strict env-based CORS for production
        await this.client.send(
            new PutBucketCorsCommand({
                Bucket: this.bucket,
                CORSConfiguration: {
                    CORSRules: [
                        {
                            AllowedHeaders: ['*'],
                            AllowedMethods: ['PUT', 'GET', 'HEAD'],
                            AllowedOrigins: ['*'],
                            ExposeHeaders: ['ETag'],
                            MaxAgeSeconds: 3600,
                        },
                    ],
                },
            }),
        );
        this.logger.log(`CORS rules applied to ${this.bucket}`);
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

    // Expose client for testing
    getClient(): S3Client {
        return this.client;
    }

    getBucket(): string {
        return this.bucket;
    }
}
