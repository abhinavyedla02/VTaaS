import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';
import { SqsService } from '../common/sqs/sqs.service';
import { DomainException } from '../common/exceptions';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface GetJobResponse {
    id: string;
    status: string;
    inputKey: string;
    outputKeys: Prisma.JsonValue | null;
    downloadUrl: string | null;
    error: string | null;
    updatedAt: Date;
}

export interface CreateJobResponse {
    id: string;
    status: string;
    submitterName?: string | null;
    note?: string | null;
}

@Injectable()
export class JobsService {
    private readonly logger = new Logger(JobsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly s3Service: S3Service,
        private readonly sqsService: SqsService,
    ) { }

    async createJob(
        userId: string,
        inputKey: string,
        submitterName?: string,
        note?: string,
        resolution?: string,
    ): Promise<CreateJobResponse> {
        // 1. Verify file exists in S3 (throws OBJECT_NOT_FOUND if missing)
        await this.s3Service.headObject(inputKey);

        try {
            // 2. Create job row (status defaults to PENDING via schema)
            const job = await this.prisma.job.create({
                data: { userId, inputKey, submitterName, note },
            });

            // 3. Enqueue transcode message (gated by ENQUEUE_ENABLED)
            const enqueueEnabled = process.env.ENQUEUE_ENABLED !== 'false';
            if (enqueueEnabled) {
                await this.sqsService.enqueueTranscode({
                    jobId: job.id,
                    inputKey: job.inputKey,
                    profiles: [resolution ?? '720p'],
                });
            } else {
                this.logger.warn(`ENQUEUE_ENABLED=false — skipping SQS dispatch for job ${job.id}`);
            }

            this.logger.log(`Job created: ${job.id} (status: ${job.status})`);
            return {
                id: job.id,
                status: job.status,
                submitterName: job.submitterName,
                note: job.note,
            };

        } catch (error: unknown) {
            // 4. Idempotency: duplicate (userId, inputKey) → return existing job
            if (
                error instanceof PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                const existing = await this.prisma.job.findUnique({
                    where: { user_input_unique: { userId, inputKey } },
                });

                if (!existing) {
                    throw new DomainException(
                        'JOB_NOT_FOUND',
                        'Race condition: job vanished between constraint violation and lookup',
                    );
                }

                this.logger.log(`Duplicate job request — returning existing: ${existing.id}`);
                return {
                    id: existing.id,
                    status: existing.status,
                    submitterName: existing.submitterName,
                    note: existing.note,
                };
            }

            throw error; // re-throw non-P2002 errors
        }
    }
    async findById(id: string): Promise<GetJobResponse | null> {
        const job = await this.prisma.job.findUnique({ where: { id } });
        if (!job) return null;

        let downloadUrl: string | null = null;

        if (
            job.status === 'SUCCEEDED' &&
            Array.isArray(job.outputKeys) &&
            job.outputKeys.length > 0 &&
            typeof job.outputKeys[0] === 'string'
        ) {
            downloadUrl = await this.s3Service.getDownloadUrl(
                'vtaas-outputs',
                job.outputKeys[0] as string,
            );
        }

        return {
            id: job.id,
            status: job.status,
            inputKey: job.inputKey,
            outputKeys: job.outputKeys,
            downloadUrl,
            error: job.error,
            updatedAt: job.updatedAt,
        };
    }
}
