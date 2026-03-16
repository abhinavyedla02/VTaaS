import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JobStatus } from '@prisma/client';
import { validateJobTransition, buildOutputKey } from '@vtaas/db';
import { PrismaService } from '../common/prisma.service';
import { WorkerS3Service } from '../s3/s3.service';
import { FfmpegService } from './ffmpeg.service';
import { TranscodePayload } from '../sqs-consumer/types';

@Injectable()
export class TranscodeService {
    private readonly logger = new Logger(TranscodeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: WorkerS3Service,
        private readonly ffmpeg: FfmpegService,
    ) {}

    async processJob(payload: TranscodePayload): Promise<void> {
        const { jobId, inputKey, profiles } = payload;

        // STEP 1 — Fetch job
        const job = await this.prisma.job.findUnique({ where: { id: jobId } });
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        // STEP 2 — SUCCEEDED guard (crash-after-success retry safety)
        if (job.status === JobStatus.SUCCEEDED) {
            this.logger.warn(
                `Job ${jobId} already SUCCEEDED — skipping (message will be deleted)`,
            );
            return;
        }

        const tmpDir = `/tmp/vtaas/${jobId}`;

        // try/catch wraps from STEP 3 so that InvalidTransitionError
        // (e.g. PROCESSING→PROCESSING on retry) is caught and the job is marked FAILED
        try {
            // STEP 3 — Transition to PROCESSING
            validateJobTransition(job.status, JobStatus.PROCESSING);
            await this.prisma.job.update({
                where: { id: jobId },
                data: { status: JobStatus.PROCESSING },
            });

            // STEP 4 — Create temp directory (once, before profiles loop)
            await fs.promises.mkdir(tmpDir, { recursive: true });

            // STEP 5 — Per-profile loop
            const outputKeys: string[] = [];

            for (const profile of profiles) {
                const outputKey = buildOutputKey(jobId, profile);

                // Dedupe check — skip if output already exists in S3
                const existing = await this.s3.headObject(
                    this.s3.getOutputBucket(),
                    outputKey,
                );
                if (existing !== null) {
                    this.logger.log(
                        `Output already exists for job ${jobId} profile ${profile} — skipping`,
                    );
                    outputKeys.push(outputKey);
                    continue;
                }

                // Download input from S3
                const inputBuffer = await this.s3.getObject('vtaas-inputs', inputKey);
                const inputPath = path.join(tmpDir, `input${path.extname(inputKey)}`);
                await fs.promises.writeFile(inputPath, inputBuffer);

                // Transcode
                const outputPath = path.join(tmpDir, `${profile}.mp4`);
                await this.ffmpeg.transcode(inputPath, outputPath, profile);

                // Upload output to S3
                const outputBuffer = await fs.promises.readFile(outputPath);
                await this.s3.putObject(
                    this.s3.getOutputBucket(),
                    outputKey,
                    outputBuffer,
                    'video/mp4',
                );

                outputKeys.push(outputKey);
                this.logger.log(`Profile ${profile} complete for job ${jobId}`);
            }

            // STEP 5b — Transition to SUCCEEDED
            await this.prisma.job.update({
                where: { id: jobId },
                data: { status: JobStatus.SUCCEEDED, outputKeys },
            });
            this.logger.log(`Job ${jobId} SUCCEEDED`);
        } catch (error: unknown) {
            // Error handler — direct prisma.job.update, NO validateJobTransition
            // (SUCCEEDED→FAILED is invalid in the state machine — skip validation)
            const errMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Job ${jobId} FAILED: ${errMsg}`);

            try {
                await this.prisma.job.update({
                    where: { id: jobId },
                    data: { status: JobStatus.FAILED, error: errMsg },
                });
            } catch (updateError: unknown) {
                const updateMsg =
                    updateError instanceof Error
                        ? updateError.message
                        : String(updateError);
                this.logger.error(
                    `Failed to mark job ${jobId} as FAILED: ${updateMsg}`,
                );
            }

            throw error; // re-throw so SqsConsumerService does NOT delete the message
        } finally {
            // Cleanup temp files — best-effort, always runs
            try {
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
            } catch (cleanupError: unknown) {
                const cleanupMsg =
                    cleanupError instanceof Error
                        ? cleanupError.message
                        : String(cleanupError);
                this.logger.warn(`Cleanup failed for ${tmpDir}: ${cleanupMsg}`);
            }
        }
    }
}
