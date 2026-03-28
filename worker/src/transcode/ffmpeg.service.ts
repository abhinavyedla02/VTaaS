import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SUPPORTED_RESOLUTIONS, Resolution } from '@vtaas/db/dist/resolutions';

const execFileAsync = promisify(execFile);

const PROFILE_SCALE_HEIGHT: Record<Resolution, number> = {
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
        if (!SUPPORTED_RESOLUTIONS.includes(profile as Resolution)) {
            throw new Error(`Unsupported profile: ${profile}`);
        }
        const scaleHeight = PROFILE_SCALE_HEIGHT[profile as Resolution];

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

