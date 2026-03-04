import { IsString, IsNotEmpty, IsInt, IsPositive } from 'class-validator';

export class CreateUploadDto {
    @IsString()
    @IsNotEmpty()
    mimeType!: string;

    @IsInt()
    @IsPositive()
    sizeBytes!: number;
}
