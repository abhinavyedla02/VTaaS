import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UploadsService } from './uploads.service';
import { CreateUploadDto } from './dto/create-upload.dto';
import { FastifyThrottlerGuard } from '../common/guards/fastify-throttler.guard';

@Controller('uploads')
export class UploadsController {
    constructor(private readonly uploadsService: UploadsService) { }

    @UseGuards(FastifyThrottlerGuard)
    @Throttle({ default: { limit: 3, ttl: 3600000 } })
    @Post()
    async create(@Body() dto: CreateUploadDto) {
        return this.uploadsService.generateUploadUrl(dto.mimeType, dto.sizeBytes);
    }
}
