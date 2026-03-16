import { Global, Module } from '@nestjs/common';
import { WorkerS3Service } from './s3.service';

@Global()
@Module({
    providers: [WorkerS3Service],
    exports: [WorkerS3Service],
})
export class S3Module { }
