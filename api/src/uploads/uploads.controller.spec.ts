import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { UploadsController } from './uploads.controller';
import { UploadsService, UploadUrlResponse } from './uploads.service';

describe('UploadsController', () => {
    let controller: UploadsController;
    let mockUploadsService: jest.Mocked<UploadsService>;

    const mockResponse: UploadUrlResponse = {
        url: 'https://presigned-url.example.com',
        inputKey: 'inputs/uuid-123.mp4',
        expiresIn: 900,
    };

    beforeEach(async () => {
        mockUploadsService = {
            generateUploadUrl: jest.fn().mockResolvedValue(mockResponse),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
            controllers: [UploadsController],
            providers: [
                { provide: UploadsService, useValue: mockUploadsService },
            ],
        }).compile();

        controller = module.get<UploadsController>(UploadsController);
    });

    describe('create', () => {
        it('returns url, inputKey, and expiresIn', async () => {
            const result = await controller.create({
                mimeType: 'video/mp4',
                sizeBytes: 1000,
            });

            expect(result).toEqual(mockResponse);
        });

        it('passes dto fields to service', async () => {
            await controller.create({
                mimeType: 'video/webm',
                sizeBytes: 5000,
            });

            expect(mockUploadsService.generateUploadUrl).toHaveBeenCalledWith(
                'video/webm',
                5000,
            );
        });
    });
});
