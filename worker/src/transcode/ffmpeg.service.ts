import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class FfmpegService {
    private readonly logger = new Logger(FfmpegService.name);

    async transcode(inputPath: string, outputPath: string, profile: string): Promise<void> {
        if (profile !== '720p') {
            throw new Error(`Unsupported profile: ${profile}`);
        }

        const args = [
            '-i', inputPath,
            '-vf', 'scale=-2:720',
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
