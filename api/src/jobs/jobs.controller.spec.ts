import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobsService, CreateJobResponse } from './jobs.service';

describe('JobsController', () => {
    let controller: JobsController;
    let mockJobsService: jest.Mocked<Partial<JobsService>>;

    const mockResponse: CreateJobResponse = {
        id: 'job-uuid-123',
        status: 'PENDING',
    };

    beforeEach(async () => {
        mockJobsService = {
            createJob: jest.fn().mockResolvedValue(mockResponse),
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
});
