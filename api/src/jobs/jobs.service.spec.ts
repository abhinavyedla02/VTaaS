import { Test, TestingModule } from '@nestjs/testing';
import { JobsService, CreateJobResponse } from './jobs.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';
import { SqsService } from '../common/sqs/sqs.service';
import { DomainException } from '../common/exceptions';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

describe('JobsService', () => {
    let service: JobsService;
    let mockPrisma: { job: { create: jest.Mock; findUnique: jest.Mock } };
    let mockHeadObject: jest.Mock;
    let mockGetDownloadUrl: jest.Mock;
    let mockEnqueueTranscode: jest.Mock;
    let savedEnqueueEnabled: string | undefined;

    const mockJob = {
        id: 'job-uuid-123',
        userId: 'test-user',
        inputKey: 'inputs/test-uuid.mp4',
        status: 'PENDING',
        requestId: null,
        outputKeys: null,
        error: null,
        submitterName: 'Alice',
        note: 'Test Note',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        savedEnqueueEnabled = process.env.ENQUEUE_ENABLED;
        delete process.env.ENQUEUE_ENABLED;

        mockPrisma = {
            job: {
                create: jest.fn().mockResolvedValue(mockJob),
                findUnique: jest.fn().mockResolvedValue(mockJob),
            },
        };

        mockHeadObject = jest.fn().mockResolvedValue({
            size: 50000,
            contentType: 'video/mp4',
        });

        mockGetDownloadUrl = jest.fn().mockResolvedValue('https://presigned-download-url.example.com');

        mockEnqueueTranscode = jest.fn().mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                JobsService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: S3Service, useValue: { headObject: mockHeadObject, getDownloadUrl: mockGetDownloadUrl } },
                { provide: SqsService, useValue: { enqueueTranscode: mockEnqueueTranscode } },
            ],
        }).compile();

        service = module.get<JobsService>(JobsService);
    });

    afterEach(() => {
        if (savedEnqueueEnabled !== undefined) {
            process.env.ENQUEUE_ENABLED = savedEnqueueEnabled;
        } else {
            delete process.env.ENQUEUE_ENABLED;
        }
    });

    describe('createJob', () => {
        it('should verify file exists via headObject before creating job', async () => {
            await service.createJob('test-user', 'inputs/test-uuid.mp4');

            expect(mockHeadObject).toHaveBeenCalledWith('inputs/test-uuid.mp4');
            expect(mockHeadObject).toHaveBeenCalledTimes(1);

            // headObject called BEFORE create
            const headCallOrder = mockHeadObject.mock.invocationCallOrder[0];
            const createCallOrder = mockPrisma.job.create.mock.invocationCallOrder[0];
            expect(headCallOrder).toBeLessThan(createCallOrder);
        });

        it('should create a PENDING job and return { id, status }', async () => {
            const result = await service.createJob('test-user', 'inputs/test-uuid.mp4', 'Alice', 'Test Note');

            expect(mockPrisma.job.create).toHaveBeenCalledWith({
                data: { userId: 'test-user', inputKey: 'inputs/test-uuid.mp4', submitterName: 'Alice', note: 'Test Note' },
            });
            expect(result).toEqual({ 
                id: 'job-uuid-123', 
                status: 'PENDING',
                submitterName: 'Alice',
                note: 'Test Note'
            });
        });

        it('should NOT create job if file does not exist in S3', async () => {
            mockHeadObject.mockRejectedValueOnce(
                new DomainException('OBJECT_NOT_FOUND', 'Object not found'),
            );

            await expect(
                service.createJob('test-user', 'inputs/missing.mp4'),
            ).rejects.toThrow(DomainException);

            expect(mockPrisma.job.create).not.toHaveBeenCalled();
        });
    });

    describe('enqueue behavior', () => {
        it('should enqueue transcode message by default (ENQUEUE_ENABLED unset)', async () => {
            await service.createJob('test-user', 'inputs/test-uuid.mp4');

            expect(mockEnqueueTranscode).toHaveBeenCalledWith({
                jobId: 'job-uuid-123',
                inputKey: 'inputs/test-uuid.mp4',
                profiles: ['720p'],
            });
        });

        it('should skip enqueue when ENQUEUE_ENABLED=false', async () => {
            process.env.ENQUEUE_ENABLED = 'false';

            await service.createJob('test-user', 'inputs/test-uuid.mp4');

            expect(mockEnqueueTranscode).not.toHaveBeenCalled();
        });

        it('should propagate enqueue errors (not swallow them)', async () => {
            mockEnqueueTranscode.mockRejectedValueOnce(new Error('SQS unavailable'));

            await expect(
                service.createJob('test-user', 'inputs/test-uuid.mp4'),
            ).rejects.toThrow('SQS unavailable');

            // Job was still created in DB before enqueue failed
            expect(mockPrisma.job.create).toHaveBeenCalled();
        });
    });

    describe('idempotency (duplicate handling)', () => {
        const p2002Error = new PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`userId`,`inputKey`)',
            { code: 'P2002', clientVersion: '5.0.0' },
        );

        it('should return existing job on duplicate (P2002)', async () => {
            mockPrisma.job.create.mockRejectedValueOnce(p2002Error);

            const result = await service.createJob('test-user', 'inputs/test-uuid.mp4', 'Alice', 'Test');

            expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({
                where: { user_input_unique: { userId: 'test-user', inputKey: 'inputs/test-uuid.mp4' } },
            });
            expect(result).toEqual({ 
                id: 'job-uuid-123', 
                status: 'PENDING',
                submitterName: 'Alice',
                note: 'Test Note'
            });
        });

        it('should NOT enqueue on duplicate', async () => {
            mockPrisma.job.create.mockRejectedValueOnce(p2002Error);

            await service.createJob('test-user', 'inputs/test-uuid.mp4');

            expect(mockEnqueueTranscode).not.toHaveBeenCalled();
        });

        it('should throw DomainException if existing job vanishes (race condition)', async () => {
            mockPrisma.job.create.mockRejectedValueOnce(p2002Error);
            mockPrisma.job.findUnique.mockResolvedValueOnce(null);

            await expect(
                service.createJob('test-user', 'inputs/test-uuid.mp4'),
            ).rejects.toThrow(DomainException);
        });

        it('should re-throw non-P2002 Prisma errors', async () => {
            const otherError = new Error('Connection lost');
            mockPrisma.job.create.mockRejectedValueOnce(otherError);

            await expect(
                service.createJob('test-user', 'inputs/test-uuid.mp4'),
            ).rejects.toThrow('Connection lost');

            expect(mockPrisma.job.findUnique).not.toHaveBeenCalled();
        });
    });

    describe('findById', () => {
        it('should return job response with downloadUrl null when status is PENDING', async () => {
            mockPrisma.job.findUnique.mockResolvedValueOnce(mockJob);

            const result = await service.findById('job-uuid-123');

            expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({
                where: { id: 'job-uuid-123' },
            });
            expect(result).toEqual({
                id: 'job-uuid-123',
                status: 'PENDING',
                inputKey: 'inputs/test-uuid.mp4',
                outputKeys: null,
                downloadUrl: null,
                error: null,
                updatedAt: mockJob.updatedAt,
            });
            expect(mockGetDownloadUrl).not.toHaveBeenCalled();
        });

        it('should return null when job does not exist', async () => {
            mockPrisma.job.findUnique.mockResolvedValueOnce(null);

            const result = await service.findById('nonexistent-id');

            expect(result).toBeNull();
        });

        it('should return downloadUrl when job is SUCCEEDED with outputKeys', async () => {
            const succeededJob = {
                ...mockJob,
                status: 'SUCCEEDED',
                outputKeys: ['outputs/job-uuid-123/720p.mp4'],
            };
            mockPrisma.job.findUnique.mockResolvedValueOnce(succeededJob);

            const result = await service.findById('job-uuid-123');

            expect(mockGetDownloadUrl).toHaveBeenCalledWith(
                'vtaas-outputs',
                'outputs/job-uuid-123/720p.mp4',
            );
            expect(result).toEqual({
                id: 'job-uuid-123',
                status: 'SUCCEEDED',
                inputKey: 'inputs/test-uuid.mp4',
                outputKeys: ['outputs/job-uuid-123/720p.mp4'],
                downloadUrl: 'https://presigned-download-url.example.com',
                error: null,
                updatedAt: mockJob.updatedAt,
            });
        });

        it('should return downloadUrl null when SUCCEEDED but outputKeys is null', async () => {
            const succeededNoOutput = {
                ...mockJob,
                status: 'SUCCEEDED',
                outputKeys: null,
            };
            mockPrisma.job.findUnique.mockResolvedValueOnce(succeededNoOutput);

            const result = await service.findById('job-uuid-123');

            expect(mockGetDownloadUrl).not.toHaveBeenCalled();
            expect(result?.downloadUrl).toBeNull();
        });

        it('should return downloadUrl null when SUCCEEDED but outputKeys is empty array', async () => {
            const succeededEmpty = {
                ...mockJob,
                status: 'SUCCEEDED',
                outputKeys: [],
            };
            mockPrisma.job.findUnique.mockResolvedValueOnce(succeededEmpty);

            const result = await service.findById('job-uuid-123');

            expect(mockGetDownloadUrl).not.toHaveBeenCalled();
            expect(result?.downloadUrl).toBeNull();
        });
    });
});
