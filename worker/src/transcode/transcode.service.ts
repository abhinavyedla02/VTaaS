import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { JobStatus } from '@prisma/client';

const execFileAsync = promisify(execFile);
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

            // STEP 4b — Download input once (shared across all profiles)
            const inputBuffer = await this.s3.getObject('vtaas-inputs', inputKey);
            const inputPath = path.join(tmpDir, `input${path.extname(inputKey)}`);
            await fs.promises.writeFile(inputPath, inputBuffer);

            // STEP 4c — ffprobe duration check (runs once, before any transcoding)
            const maxDuration = parseInt(
                process.env.MAX_VIDEO_DURATION_SECONDS ?? '60',
                10,
            );
            try {
                const { stdout } = await execFileAsync('ffprobe', [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_format',
                    inputPath,
                ]);
                const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
                const duration = parseFloat(parsed.format?.duration ?? '0');
                if (duration > maxDuration) {
                    this.logger.warn(
                        `Job ${jobId} rejected: duration ${duration}s exceeds ${maxDuration}s limit`,
                    );
                    await this.prisma.job.update({
                        where: { id: jobId },
                        data: {
                            status: JobStatus.FAILED,
                            error: `VIDEO_TOO_LONG: video exceeds ${maxDuration} second limit`,
                        },
                    });
                    return; // early return — finally still runs, temp files cleaned up
                    // NOTE: we do NOT re-throw here — this is a validation failure,
                    // not a transient error. SQS consumer SHOULD delete this message.
                }
            } catch (ffprobeError: unknown) {
                // Fail-safe: if ffprobe errors, log and proceed with transcoding
                const msg =
                    ffprobeError instanceof Error
                        ? ffprobeError.message
                        : String(ffprobeError);
                this.logger.warn(`ffprobe failed for job ${jobId}, proceeding anyway: ${msg}`);
            }

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
