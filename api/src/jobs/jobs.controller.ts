import { Controller, Post, Get, Param, Body, NotFoundException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { User } from '../common/decorators/user.decorator';
import { FastifyThrottlerGuard } from '../common/guards/fastify-throttler.guard';

@Controller('jobs')
export class JobsController {
    constructor(private readonly jobsService: JobsService) { }

    @UseGuards(FastifyThrottlerGuard)
    @Throttle({ default: { limit: 3, ttl: 3600000 } })
    @Post()
    async create(@User() userId: string, @Body() dto: CreateJobDto) {
        return this.jobsService.createJob(userId, dto.inputKey, dto.submitterName, dto.note, dto.resolution);
    }

    @Get(':id')
    async findById(@Param('id') id: string) {
        const job = await this.jobsService.findById(id);
        if (!job) {
            throw new NotFoundException(`Job ${id} not found`);
        }
        return job;
    }
}
