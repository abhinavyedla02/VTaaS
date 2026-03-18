import { Module } from '@nestjs/common';
import { TranscodeService } from './transcode.service';
import { FfmpegService } from './ffmpeg.service';

@Module({
    providers: [TranscodeService, FfmpegService],
    exports: [TranscodeService],
})
export class TranscodeModule {}
