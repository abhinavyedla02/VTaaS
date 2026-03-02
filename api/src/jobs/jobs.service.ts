import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';
import { SqsService } from '../common/sqs/sqs.service';
import { DomainException } from '../common/exceptions';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface CreateJobResponse {
    id: string;
    status: string;
}

@Injectable()
export class JobsService {
    private readonly logger = new Logger(JobsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly s3Service: S3Service,
        private readonly sqsService: SqsService,
    ) { }

    async createJob(userId: string, inputKey: string): Promise<CreateJobResponse> {
        // 1. Verify file exists in S3 (throws OBJECT_NOT_FOUND if missing)
        await this.s3Service.headObject(inputKey);

        try {
            // 2. Create job row (status defaults to PENDING via schema)
            const job = await this.prisma.job.create({
                data: { userId, inputKey },
            });

            // 3. Enqueue transcode message (gated by ENQUEUE_ENABLED)
            const enqueueEnabled = process.env.ENQUEUE_ENABLED !== 'false';
            if (enqueueEnabled) {
                await this.sqsService.enqueueTranscode({
                    jobId: job.id,
                    inputKey: job.inputKey,
                    profiles: ['720p'],
                });
            } else {
                this.logger.warn(`ENQUEUE_ENABLED=false — skipping SQS dispatch for job ${job.id}`);
            }

            this.logger.log(`Job created: ${job.id} (status: ${job.status})`);
            return { id: job.id, status: job.status };

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
                return { id: existing.id, status: existing.status };
            }

            throw error; // re-throw non-P2002 errors
        }
    }
}
