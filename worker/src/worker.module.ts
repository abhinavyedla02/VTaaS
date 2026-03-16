import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { S3Module } from './s3/s3.module';
import { SqsConsumerModule } from './sqs-consumer/sqs-consumer.module';
import { TranscodeModule } from './transcode/transcode.module';

@Module({
    imports: [PrismaModule, S3Module, SqsConsumerModule, TranscodeModule],
})
export class WorkerModule {}
