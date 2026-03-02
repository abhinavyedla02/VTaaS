import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { LoggingInterceptor } from './common/logging.interceptor';
import { DevUserInterceptor } from './common/interceptors/dev-user.interceptor';
import { PrismaModule } from './common/prisma.module';
import { S3Module } from './common/s3/s3.module';
import { SqsModule } from './common/sqs/sqs.module';
import { UploadsModule } from './uploads/uploads.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [PrismaModule, S3Module, SqsModule, UploadsModule, JobsModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DevUserInterceptor,
    },
  ],
})
export class AppModule { }

