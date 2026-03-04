import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';

@Module({
    imports: [PrismaModule],
})
export class WorkerModule { }
