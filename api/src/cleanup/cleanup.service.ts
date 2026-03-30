import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: S3Service,
    ) {}

    @Cron('0 * * * *')
    async purgeOldData() {
        this.logger.log('Starting hourly cleanup job...');
        const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

        try {
            const oldJobs = await this.prisma.job.findMany({
                where: { 
                    createdAt: { lt: cutoffDate },
                    status: { not: JobStatus.PROCESSING },
                },
                select: { id: true, inputKey: true, outputKeys: true },
            });

            for (const job of oldJobs) {
                try {
                    // 1. Delete Input File
                    await this.s3.deleteObject(this.s3.getBucket(), job.inputKey);

                    // 2. Delete Output Files
                    const keys = Array.isArray(job.outputKeys) ? job.outputKeys as string[] : [];
                    for (const key of keys) {
                        await this.s3.deleteObject(this.s3.getOutputBucket(), key);
                    }

                    // 3. Delete DB record
                    await this.prisma.job.delete({ where: { id: job.id } });
                    
                    this.logger.log(`Successfully purged job ${job.id}`);
                } catch (error: unknown) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Failed to purge job ${job.id}: ${msg}`);
                }
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to execute cleanup query: ${msg}`);
        }
        
        this.logger.log('Cleanup job complete.');
    }
}
