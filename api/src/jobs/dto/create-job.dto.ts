import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { SUPPORTED_RESOLUTIONS } from '@vtaas/db';

export class CreateJobDto {
    @IsString()
    @IsNotEmpty()
    inputKey!: string;

    @IsOptional()
    @IsString()
    submitterName?: string;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsIn([...SUPPORTED_RESOLUTIONS])
    resolution?: string;
}
