import { Module } from '@nestjs/common';
import { SqsConsumerService } from './sqs-consumer.service';
import { TranscodeModule } from '../transcode/transcode.module';

@Module({
    imports: [TranscodeModule],
    providers: [SqsConsumerService],
    exports: [SqsConsumerService],
})
export class SqsConsumerModule {}
