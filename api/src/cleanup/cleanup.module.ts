import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { PrismaModule } from '../common/prisma.module';
import { S3Module } from '../common/s3/s3.module';

@Module({
    imports: [PrismaModule, S3Module],
    providers: [CleanupService],
})
export class CleanupModule {}
