import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { LoggingInterceptor } from './common/logging.interceptor';
import { PrismaModule } from './common/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule { }

