import { FfmpegService } from './ffmpeg.service';
import { execFile } from 'child_process';

// Mock child_process at module level
jest.mock('child_process', () => ({
    execFile: jest.fn(),
}));

const mockExecFile = execFile as unknown as jest.Mock;

describe('FfmpegService', () => {
    let service: FfmpegService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new FfmpegService();
    });

    it('builds correct args for 720p profile', async () => {
        mockExecFile.mockImplementation(
            (
                _cmd: string,
                _args: string[],
                callback: (error: Error | null, stdout: string, stderr: string) => void,
            ) => {
                callback(null, '', '');
            },
        );

        await service.transcode('/tmp/input.mp4', '/tmp/output.mp4', '720p');

        expect(mockExecFile).toHaveBeenCalledWith(
            'ffmpeg',
            [
                '-i', '/tmp/input.mp4',
                '-vf', 'scale=-2:720',
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-y', '/tmp/output.mp4',
            ],
            expect.any(Function),
        );
    });

    it('resolves on exit code 0', async () => {
        mockExecFile.mockImplementation(
            (
                _cmd: string,
                _args: string[],
                callback: (error: Error | null, stdout: string, stderr: string) => void,
            ) => {
                callback(null, '', '');
            },
        );

        await expect(
            service.transcode('/tmp/input.mp4', '/tmp/output.mp4', '720p'),
        ).resolves.toBeUndefined();
    });

    it('rejects on non-zero exit code', async () => {
        mockExecFile.mockImplementation(
            (
                _cmd: string,
                _args: string[],
                callback: (error: Error | null, stdout: string, stderr: string) => void,
            ) => {
                const error = new Error('Command failed');
                (error as unknown as Record<string, unknown>).stderr = 'ffmpeg error output';
                (error as unknown as Record<string, unknown>).code = 1;
                callback(error, '', 'ffmpeg error output');
            },
        );

        await expect(
            service.transcode('/tmp/input.mp4', '/tmp/output.mp4', '720p'),
        ).rejects.toThrow('Command failed');
    });

    it('throws on unsupported profile', async () => {
        await expect(
            service.transcode('/tmp/input.mp4', '/tmp/output.mp4', '1080p'),
        ).rejects.toThrow('Unsupported profile: 1080p');

        // Verify execFile was NOT called
        expect(mockExecFile).not.toHaveBeenCalled();
    });
});
