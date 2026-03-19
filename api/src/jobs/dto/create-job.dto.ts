import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
}
