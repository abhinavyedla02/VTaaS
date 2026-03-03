import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService, CreateJobResponse, GetJobResponse } from './jobs.service';

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
            await controller.create('test-user', { inputKey: 'inputs/test.mp4' });

            expect(mockJobsService.createJob).toHaveBeenCalledWith(
                'test-user',
                'inputs/test.mp4',
            );
        });

        it('should return { id, status } from service', async () => {
            const result = await controller.create('test-user', { inputKey: 'inputs/test.mp4' });

            expect(result).toEqual({ id: 'job-uuid-123', status: 'PENDING' });
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
