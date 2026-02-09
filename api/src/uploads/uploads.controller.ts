import { Controller, Post, Body } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { CreateUploadDto } from './dto/create-upload.dto';

@Controller('uploads')
export class UploadsController {
    constructor(private readonly uploadsService: UploadsService) { }

    @Post()
    async create(@Body() dto: CreateUploadDto) {
        return this.uploadsService.generateUploadUrl(dto.mimeType, dto.sizeBytes);
    }
}
