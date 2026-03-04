import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const logger = new Logger('WorkerBootstrap');
    const app = await NestFactory.createApplicationContext(WorkerModule);
    logger.log('Worker started — awaiting SQS consumer (Issue 5.1)');

    // Keep the event loop alive. In 5.1, the SQS polling loop will
    // serve this purpose. For now, a heartbeat interval prevents
    // Docker from restarting the container in a loop.
    const heartbeat = setInterval(() => {
        logger.debug('Worker heartbeat — alive');
    }, 30_000);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.log(`${signal} received — shutting down...`);
        clearInterval(heartbeat);
        await app.close();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
bootstrap();
