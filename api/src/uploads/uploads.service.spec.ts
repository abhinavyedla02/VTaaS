import { Test, TestingModule } from '@nestjs/testing';
import { UploadsService, UploadUrlResponse } from './uploads.service';
import { S3Service } from '../common/s3/s3.service';
import { DomainException } from '../common/exceptions';

describe('UploadsService', () => {
    let service: UploadsService;
    let mockS3Service: jest.Mocked<S3Service>;

    beforeEach(async () => {
        mockS3Service = {
            getPresignedPutUrl: jest.fn().mockResolvedValue('https://presigned-url.example.com'),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UploadsService,
                { provide: S3Service, useValue: mockS3Service },
            ],
        }).compile();

        service = module.get<UploadsService>(UploadsService);
    });

    afterEach(() => {
        delete process.env.MAX_UPLOAD_SIZE_BYTES;
        delete process.env.UPLOAD_EXPIRY_SECONDS;
    });

    describe('generateUploadUrl', () => {
        it('returns url, inputKey, and expiresIn', async () => {
            const result = await service.generateUploadUrl('video/mp4', 1000);

            expect(result).toHaveProperty('url');
            expect(result).toHaveProperty('inputKey');
            expect(result).toHaveProperty('expiresIn');
            expect(result.url).toBe('https://presigned-url.example.com');
        });

        it('inputKey matches inputs/{uuid}.{ext} pattern', async () => {
            const result = await service.generateUploadUrl('video/mp4', 1000);

            expect(result.inputKey).toMatch(/^inputs\/[0-9a-f-]{36}\.mp4$/);
        });

        it('throws UNSUPPORTED_MIME_TYPE for invalid mime type', async () => {
            await expect(service.generateUploadUrl('image/png', 1000))
                .rejects.toThrow(DomainException);

            try {
                await service.generateUploadUrl('image/png', 1000);
            } catch (e) {
                expect((e as DomainException).code).toBe('UNSUPPORTED_MIME_TYPE');
            }
        });

        it('throws FILE_TOO_LARGE for oversized file', async () => {
            await expect(service.generateUploadUrl('video/mp4', 600000000))
                .rejects.toThrow(DomainException);

            try {
                await service.generateUploadUrl('video/mp4', 600000000);
            } catch (e) {
                expect((e as DomainException).code).toBe('FILE_TOO_LARGE');
            }
        });

        it('uses env var for MAX_UPLOAD_SIZE_BYTES', async () => {
            process.env.MAX_UPLOAD_SIZE_BYTES = '500'; // 500 bytes

            await expect(service.generateUploadUrl('video/mp4', 1000))
                .rejects.toThrow(DomainException);
        });

        it('uses env var for UPLOAD_EXPIRY_SECONDS', async () => {
            process.env.UPLOAD_EXPIRY_SECONDS = '60';

            const result = await service.generateUploadUrl('video/mp4', 1000);

            expect(result.expiresIn).toBe(60);
        });

        it('falls back to defaults when env vars are missing', async () => {
            delete process.env.MAX_UPLOAD_SIZE_BYTES;
            delete process.env.UPLOAD_EXPIRY_SECONDS;

            const result = await service.generateUploadUrl('video/mp4', 1000);

            expect(result.expiresIn).toBe(900); // DEFAULT_UPLOAD_EXPIRY
        });

        it('handles NaN env vars gracefully', async () => {
            process.env.MAX_UPLOAD_SIZE_BYTES = 'invalid';
            process.env.UPLOAD_EXPIRY_SECONDS = 'invalid';

            // Should not throw — uses defaults
            const result = await service.generateUploadUrl('video/mp4', 1000);

            expect(result.expiresIn).toBe(900);
        });

        it('calls S3Service with correct arguments', async () => {
            process.env.UPLOAD_EXPIRY_SECONDS = '120';

            await service.generateUploadUrl('video/mp4', 1000);

            expect(mockS3Service.getPresignedPutUrl).toHaveBeenCalledWith(
                expect.stringMatching(/^inputs\/[0-9a-f-]{36}\.mp4$/),
                'video/mp4',
                120,
            );
        });
    });
});
