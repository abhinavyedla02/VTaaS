import { IsString, IsNotEmpty } from 'class-validator';

export class CreateJobDto {
    @IsString()
    @IsNotEmpty()
    inputKey!: string;
}
