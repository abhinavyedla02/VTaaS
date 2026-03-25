import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PROFILE_SCALE_HEIGHT: Record<string, number> = {
    '240p': 240,
    '360p': 360,
    '480p': 480,
    '720p': 720,
    '1080p': 1080,
};

@Injectable()
export class FfmpegService {
    private readonly logger = new Logger(FfmpegService.name);

    async transcode(inputPath: string, outputPath: string, profile: string): Promise<void> {
        const scaleHeight = PROFILE_SCALE_HEIGHT[profile];
        if (scaleHeight === undefined) {
            throw new Error(`Unsupported profile: ${profile}`);
        }

        const args = [
            '-i', inputPath,
            '-vf', `scale=-2:${scaleHeight}`,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-y', outputPath,
        ];

        this.logger.log(`Transcoding to ${profile}: ${inputPath} → ${outputPath}`);
        await execFileAsync('ffmpeg', args);
    }
}

