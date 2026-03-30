import { TranscodeService } from './transcode.service';
import { PrismaService } from '../common/prisma.service';
import { WorkerS3Service } from '../s3/s3.service';
import { FfmpegService } from './ffmpeg.service';
import { JobStatus } from '@prisma/client';
import * as fs from 'fs';
import { execFile } from 'child_process';

jest.mock('child_process', () => {
    const actual = jest.requireActual('child_process');
    return {
        ...actual,
        execFile: jest.fn(),
    };
});

// Mock only fs.promises — preserve the rest of fs (Prisma client uses fs.existsSync at import)
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        promises: {
            mkdir: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue(undefined),
            readFile: jest.fn().mockResolvedValue(Buffer.from('output-video')),
            rm: jest.fn().mockResolvedValue(undefined),
        },
    };
});

describe('TranscodeService', () => {
    let service: TranscodeService;
    let mockPrisma: {
        job: { findUnique: jest.Mock; update: jest.Mock };
    };
    let mockS3: {
        headObject: jest.Mock;
        getObject: jest.Mock;
        putObject: jest.Mock;
        getInputBucket: jest.Mock;
        getOutputBucket: jest.Mock;
    };
    let mockFfmpeg: { transcode: jest.Mock };

    const payload = {
        jobId: 'job-123',
        inputKey: 'inputs/abc.mp4',
        profiles: ['720p'],
    };

    const pendingJob = {
        id: 'job-123',
        userId: 'user-1',
        requestId: null,
        status: JobStatus.PENDING,
        inputKey: 'inputs/abc.mp4',
        outputKeys: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockPrisma = {
            job: {
                findUnique: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
        };

        mockS3 = {
            headObject: jest.fn(),
            getObject: jest.fn(),
            putObject: jest.fn().mockResolvedValue(undefined),
            getInputBucket: jest.fn().mockReturnValue('vtaas-inputs'),
            getOutputBucket: jest.fn().mockReturnValue('vtaas-outputs'),
        };

        mockFfmpeg = {
            transcode: jest.fn().mockResolvedValue(undefined),
        };

        service = new TranscodeService(
            mockPrisma as unknown as PrismaService,
            mockS3 as unknown as WorkerS3Service,
            mockFfmpeg as unknown as FfmpegService,
        );

        // Reset fs mock defaults
        jest.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
        jest.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
        jest.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('output-video'));
        jest.mocked(fs.promises.rm).mockResolvedValue(undefined);

        // Reset execFile to succeed with duration < 60
        jest.mocked(execFile).mockImplementation((...args: any[]) => {
            const cb = args[args.length - 1];
            cb(null, { stdout: JSON.stringify({ format: { duration: '30.0' } }) }, '');
            return {} as any;
        });
    });

    it('happy path — full sequence PENDING→PROCESSING→SUCCEEDED, outputKeys set', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.headObject.mockResolvedValue(null); // no existing output
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));

        await service.processJob(payload);

        // Verify transition to PROCESSING
        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: { status: JobStatus.PROCESSING },
        });

        // Verify ffmpeg was called with correct paths
        expect(mockFfmpeg.transcode).toHaveBeenCalledWith(
            expect.stringContaining('input.mp4'),
            expect.stringContaining('720p.mp4'),
            '720p',
        );

        // Verify output uploaded
        expect(mockS3.putObject).toHaveBeenCalledWith(
            'vtaas-outputs',
            'outputs/job-123/720p.mp4',
            expect.any(Buffer),
            'video/mp4',
        );

        // Verify transition to SUCCEEDED with outputKeys
        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: {
                status: JobStatus.SUCCEEDED,
                outputKeys: ['outputs/job-123/720p.mp4'],
            },
        });
    });

    it('dedupe path — headObject returns metadata, ffmpeg NOT called, job SUCCEEDED', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.headObject.mockResolvedValue({ size: 50000, contentType: 'video/mp4' });

        await service.processJob(payload);

        // ffmpeg should NOT be called (but S3 download is called unconditionally now)
        expect(mockFfmpeg.transcode).not.toHaveBeenCalled();
        expect(mockS3.getObject).toHaveBeenCalled();

        // Transition to SUCCEEDED still happens with the dedupe key
        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: {
                status: JobStatus.SUCCEEDED,
                outputKeys: ['outputs/job-123/720p.mp4'],
            },
        });
    });

    it('ffmpeg failure — job transitions to FAILED, error set, error re-thrown', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.headObject.mockResolvedValue(null);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));
        mockFfmpeg.transcode.mockRejectedValue(new Error('ffmpeg crashed'));

        await expect(service.processJob(payload)).rejects.toThrow('ffmpeg crashed');

        // Verify job marked FAILED with error message
        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: { status: JobStatus.FAILED, error: 'ffmpeg crashed' },
        });
    });

    it('job not found — throws before any DB write or transition', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(null);

        await expect(service.processJob(payload)).rejects.toThrow(
            'Job job-123 not found',
        );

        // No DB update should have been attempted
        expect(mockPrisma.job.update).not.toHaveBeenCalled();
    });

    it('SUCCEEDED guard — already-SUCCEEDED job returns early, no DB writes, no ffmpeg', async () => {
        const succeededJob = { ...pendingJob, status: JobStatus.SUCCEEDED };
        mockPrisma.job.findUnique.mockResolvedValue(succeededJob);

        await service.processJob(payload);

        expect(mockPrisma.job.update).not.toHaveBeenCalled();
        expect(mockFfmpeg.transcode).not.toHaveBeenCalled();
        expect(mockS3.getObject).not.toHaveBeenCalled();
    });

    it('PROCESSING→PROCESSING guard — validateJobTransition throws, job marked FAILED, error re-thrown', async () => {
        const processingJob = { ...pendingJob, status: JobStatus.PROCESSING };
        mockPrisma.job.findUnique.mockResolvedValue(processingJob);

        await expect(service.processJob(payload)).rejects.toThrow(
            'Cannot transition job status from PROCESSING to PROCESSING',
        );

        // Verify job marked FAILED (direct update, no validateJobTransition)
        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: {
                status: JobStatus.FAILED,
                error: 'Cannot transition job status from PROCESSING to PROCESSING',
            },
        });
    });

    it('temp directory cleaned up on success', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.headObject.mockResolvedValue(null);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));

        await service.processJob(payload);

        expect(jest.mocked(fs.promises.rm)).toHaveBeenCalledWith(
            '/tmp/vtaas/job-123',
            { recursive: true, force: true },
        );
    });

    it('temp directory cleaned up on failure', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.headObject.mockResolvedValue(null);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));
        mockFfmpeg.transcode.mockRejectedValue(new Error('crash'));

        await expect(service.processJob(payload)).rejects.toThrow('crash');

        expect(jest.mocked(fs.promises.rm)).toHaveBeenCalledWith(
            '/tmp/vtaas/job-123',
            { recursive: true, force: true },
        );
    });

    it('duration over limit → job marked FAILED with VIDEO_TOO_LONG, ffmpeg NOT called', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));
        jest.mocked(execFile).mockImplementation((...args: any[]) => {
            const cb = args[args.length - 1];
            cb(null, { stdout: JSON.stringify({ format: { duration: '65.5' } }) }, '');
            return {} as any;
        });

        await service.processJob(payload);

        expect(mockPrisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job-123' },
            data: { status: JobStatus.FAILED, error: 'VIDEO_TOO_LONG: video exceeds 60 second limit' },
        });
        expect(mockFfmpeg.transcode).not.toHaveBeenCalled();
    });

    it('ffprobe throws → warning logged, transcode proceeds', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));
        mockS3.headObject.mockResolvedValue(null);
        jest.mocked(execFile).mockImplementation((...args: any[]) => {
            const cb = args[args.length - 1];
            cb(new Error('ffprobe missing'), null, '');
            return {} as any;
        });

        await service.processJob(payload);

        expect(mockFfmpeg.transcode).toHaveBeenCalled();
        expect(mockPrisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: JobStatus.SUCCEEDED }) })
        );
    });

    it('ffprobe returns malformed JSON → warning logged, transcode proceeds', async () => {
        mockPrisma.job.findUnique.mockResolvedValue(pendingJob);
        mockS3.getObject.mockResolvedValue(Buffer.from('input-video'));
        mockS3.headObject.mockResolvedValue(null);
        jest.mocked(execFile).mockImplementation((...args: any[]) => {
            const cb = args[args.length - 1];
            cb(null, { stdout: '{ bad json }' }, '');
            return {} as any;
        });

        await service.processJob(payload);

        expect(mockFfmpeg.transcode).toHaveBeenCalled();
        expect(mockPrisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: JobStatus.SUCCEEDED }) })
        );
    });
});
