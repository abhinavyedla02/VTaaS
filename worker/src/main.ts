import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const logger = new Logger('WorkerBootstrap');
    const app = await NestFactory.createApplicationContext(WorkerModule);
    logger.log('Worker started');

    // SqsConsumerService.onModuleInit() starts the polling loop
    // automatically — no manual wiring needed. The SQS long-poll
    // loop keeps the event loop alive.

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.log(`${signal} received — shutting down...`);
        await app.close();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
bootstrap();
