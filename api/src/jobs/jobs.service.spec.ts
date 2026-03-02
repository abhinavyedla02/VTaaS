import { Test, TestingModule } from '@nestjs/testing';
import { JobsService, CreateJobResponse } from './jobs.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';
import { DomainException } from '../common/exceptions';

describe('JobsService', () => {
    let service: JobsService;
    let mockPrisma: any;
    let mockHeadObject: jest.Mock;

    const mockJob = {
        id: 'job-uuid-123',
        userId: 'test-user',
        inputKey: 'inputs/test-uuid.mp4',
        status: 'PENDING',
        requestId: null,
        outputKeys: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        mockPrisma = {
            job: {
                create: jest.fn().mockResolvedValue(mockJob),
            },
        };

        mockHeadObject = jest.fn().mockResolvedValue({
            size: 50000,
            contentType: 'video/mp4',
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                JobsService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: S3Service, useValue: { headObject: mockHeadObject } },
            ],
        }).compile();

        service = module.get<JobsService>(JobsService);
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
            const result = await service.createJob('test-user', 'inputs/test-uuid.mp4');

            expect(mockPrisma.job.create).toHaveBeenCalledWith({
                data: { userId: 'test-user', inputKey: 'inputs/test-uuid.mp4' },
            });
            expect(result).toEqual({ id: 'job-uuid-123', status: 'PENDING' });
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
});
