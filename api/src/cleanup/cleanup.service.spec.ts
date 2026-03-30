import { Test, TestingModule } from '@nestjs/testing';
import { CleanupService } from './cleanup.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/s3/s3.service';
import { JobStatus } from '@prisma/client';

describe('CleanupService', () => {
    let service: CleanupService;
    let mockPrisma: any;
    let mockS3: any;

    beforeEach(async () => {
        mockPrisma = {
            job: {
                findMany: jest.fn(),
                delete: jest.fn(),
            },
        };
        mockS3 = {
            deleteObject: jest.fn(),
            getBucket: jest.fn().mockReturnValue('vtaas-inputs'),
            getOutputBucket: jest.fn().mockReturnValue('vtaas-outputs'),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CleanupService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: S3Service, useValue: mockS3 },
            ],
        }).compile();

        service = module.get<CleanupService>(CleanupService);
    });

    it('should find jobs older than 24 hours (not PROCESSING) and delete logic', async () => {
        const mockJobs = [
            { id: 'job-1', inputKey: 'in1.mp4', outputKeys: ['out1.mp4'] },
            { id: 'job-2', inputKey: 'in2.mp4', outputKeys: null },
        ];
        mockPrisma.job.findMany.mockResolvedValue(mockJobs);

        await service.purgeOldData();

        expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: { not: JobStatus.PROCESSING },
                }),
            }),
        );

        // Job 1
        expect(mockS3.deleteObject).toHaveBeenCalledWith('vtaas-inputs', 'in1.mp4');
        expect(mockS3.deleteObject).toHaveBeenCalledWith('vtaas-outputs', 'out1.mp4');
        expect(mockPrisma.job.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });

        // Job 2
        expect(mockS3.deleteObject).toHaveBeenCalledWith('vtaas-inputs', 'in2.mp4');
        // No outputs, not called
        expect(mockPrisma.job.delete).toHaveBeenCalledWith({ where: { id: 'job-2' } });
    });

    it('should catch error on individual job and continue processing others', async () => {
        const mockJobs = [
            { id: 'job-1', inputKey: 'in1.mp4', outputKeys: [] },
            { id: 'job-2', inputKey: 'in2.mp4', outputKeys: [] },
        ];
        mockPrisma.job.findMany.mockResolvedValue(mockJobs);
        mockS3.deleteObject.mockRejectedValueOnce(new Error('S3 error')); // Fails job-1

        await service.purgeOldData();

        expect(mockS3.deleteObject).toHaveBeenCalledWith('vtaas-inputs', 'in1.mp4');
        expect(mockPrisma.job.delete).not.toHaveBeenCalledWith({ where: { id: 'job-1' } }); // DB delete skipped

        expect(mockS3.deleteObject).toHaveBeenCalledWith('vtaas-inputs', 'in2.mp4');
        expect(mockPrisma.job.delete).toHaveBeenCalledWith({ where: { id: 'job-2' } }); // job-2 still works
    });
});
