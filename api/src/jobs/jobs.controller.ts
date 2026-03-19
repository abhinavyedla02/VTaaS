import { Controller, Post, Get, Param, Body, NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { User } from '../common/decorators/user.decorator';

@Controller('jobs')
export class JobsController {
    constructor(private readonly jobsService: JobsService) { }

    @Post()
    async create(@User() userId: string, @Body() dto: CreateJobDto) {
        return this.jobsService.createJob(userId, dto.inputKey, dto.submitterName, dto.note);
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
