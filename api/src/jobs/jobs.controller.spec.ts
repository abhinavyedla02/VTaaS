import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService, CreateJobResponse, GetJobResponse } from './jobs.service';
import { DomainException } from '../common/exceptions';

describe('JobsController', () => {
    let controller: JobsController;
    let mockJobsService: jest.Mocked<Partial<JobsService>>;

    const mockCreateResponse: CreateJobResponse = {
        id: 'job-uuid-123',
        status: 'PENDING',
    };

    const mockGetResponse: GetJobResponse = {
        id: 'job-uuid-123',
        status: 'PENDING',
        inputKey: 'inputs/test-uuid.mp4',
        outputKeys: null,
        error: null,
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        mockJobsService = {
            createJob: jest.fn().mockResolvedValue(mockCreateResponse),
            findById: jest.fn().mockResolvedValue(mockGetResponse),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [JobsController],
            providers: [
                { provide: JobsService, useValue: mockJobsService },
            ],
        }).compile();

        controller = module.get<JobsController>(JobsController);
    });

    describe('create', () => {
        it('should delegate to jobsService.createJob with userId and inputKey', async () => {
            await controller.create('test-user', { 
                inputKey: 'inputs/test.mp4', 
                submitterName: 'Alice', 
                note: 'Test' 
            });

            expect(mockJobsService.createJob).toHaveBeenCalledWith(
                'test-user',
                'inputs/test.mp4',
                'Alice',
                'Test'
            );
        });

        it('should return { id, status } from service', async () => {
            const result = await controller.create('test-user', { inputKey: 'inputs/test.mp4' });

            expect(result).toEqual({ id: 'job-uuid-123', status: 'PENDING' });
        });

        it('should propagate DomainException when file is missing in S3', async () => {
            jest.mocked(mockJobsService.createJob!).mockRejectedValueOnce(
                new DomainException('OBJECT_NOT_FOUND', 'Object not found'),
            );

            await expect(
                controller.create('test-user', { inputKey: 'inputs/missing.mp4' }),
            ).rejects.toThrow(DomainException);
        });

        it('should return existing job on duplicate (idempotent)', async () => {
            const existingJob: CreateJobResponse = { id: 'existing-uuid', status: 'PENDING' };
            jest.mocked(mockJobsService.createJob!).mockResolvedValueOnce(existingJob);

            const result = await controller.create('test-user', { inputKey: 'inputs/dup.mp4' });

            expect(result).toEqual({ id: 'existing-uuid', status: 'PENDING' });
        });
    });

    describe('findById', () => {
        it('should delegate to jobsService.findById with id param', async () => {
            await controller.findById('job-uuid-123');

            expect(mockJobsService.findById).toHaveBeenCalledWith('job-uuid-123');
        });

        it('should return job response when found', async () => {
            const result = await controller.findById('job-uuid-123');

            expect(result).toEqual(mockGetResponse);
        });

        it('should throw NotFoundException when job is null', async () => {
            jest.mocked(mockJobsService.findById!).mockResolvedValueOnce(null);

            await expect(
                controller.findById('nonexistent-id'),
            ).rejects.toThrow(NotFoundException);
        });
    });
});
