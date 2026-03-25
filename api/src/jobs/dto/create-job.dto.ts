import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

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
    @IsIn(['240p', '360p', '480p', '720p', '1080p'])
    resolution?: string;
}
