import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';

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
    ) { }

    async createJob(userId: string, inputKey: string): Promise<CreateJobResponse> {
        // 1. Verify file exists in S3 (throws OBJECT_NOT_FOUND if missing)
        await this.s3Service.headObject(inputKey);

        // 2. Create job row (status defaults to PENDING via schema)
        const job = await this.prisma.job.create({
            data: { userId, inputKey },
        });

        this.logger.log(`Job created: ${job.id} (status: ${job.status})`);

        return { id: job.id, status: job.status };
    }
}
