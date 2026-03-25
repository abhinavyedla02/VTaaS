import { S3Service } from './s3.service';
import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    PutBucketCorsCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { DomainException } from '../exceptions';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return {
        ...actual,
        S3Client: jest.fn().mockImplementation(() => ({
            send: jest.fn(),
        })),
    };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest.fn().mockResolvedValue('https://presigned-url.example.com'),
}));

describe('S3Service', () => {
    let service: S3Service;
    let mockSend: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new S3Service();
        mockSend = service.getClient().send as jest.Mock;
    });

    describe('onModuleInit', () => {
        it('should skip bucket creation if bucket already exists', async () => {
            // HeadBucket succeeds = bucket exists
            mockSend.mockResolvedValueOnce({});

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(1);
            expect(mockSend).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
        });

        it('should create bucket and apply CORS if bucket does not exist', async () => {
            // HeadBucket throws NotFound
            const notFoundError = new Error('NotFound');
            notFoundError.name = 'NotFound';
            mockSend
                .mockRejectedValueOnce(notFoundError) // HeadBucket fails
                .mockResolvedValueOnce({}) // CreateBucket succeeds
                .mockResolvedValueOnce({}); // PutBucketCors succeeds

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(3);
            expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadBucketCommand));
            expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(CreateBucketCommand));
            expect(mockSend).toHaveBeenNthCalledWith(3, expect.any(PutBucketCorsCommand));
        });

        it('should apply correct CORS configuration', async () => {
            const notFoundError = new Error('NotFound');
            notFoundError.name = 'NotFound';
            mockSend
                .mockRejectedValueOnce(notFoundError)
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({});

            await service.onModuleInit();

            const corsCall = mockSend.mock.calls[2][0];
            expect(corsCall.input.CORSConfiguration.CORSRules[0]).toEqual({
                AllowedHeaders: ['*'],
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedOrigins: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
            });
        });

        it('should rethrow unexpected errors', async () => {
            const unexpectedError = new Error('Connection refused');
            mockSend.mockRejectedValueOnce(unexpectedError);

            await expect(service.onModuleInit()).rejects.toThrow('Connection refused');
        });
    });

    describe('getPresignedPutUrl', () => {
        it('should return a presigned URL', async () => {
            const url = await service.getPresignedPutUrl('inputs/test.mp4', 'video/mp4', 900);

            expect(url).toBe('https://presigned-url.example.com');
        });
    });

    describe('headObject', () => {
        it('should return size and contentType for existing object', async () => {
            mockSend.mockResolvedValueOnce({
                ContentLength: 50000,
                ContentType: 'video/mp4',
            });

            const result = await service.headObject('inputs/test.mp4');

            expect(result).toEqual({ size: 50000, contentType: 'video/mp4' });
            expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
        });

        it('should throw OBJECT_NOT_FOUND for missing key', async () => {
            const notFoundError = new Error('NotFound');
            notFoundError.name = 'NotFound';
            mockSend.mockRejectedValueOnce(notFoundError);

            await expect(service.headObject('inputs/missing.mp4'))
                .rejects.toThrow(DomainException);

            try {
                mockSend.mockRejectedValueOnce(notFoundError);
                await service.headObject('inputs/missing.mp4');
            } catch (e) {
                expect((e as DomainException).code).toBe('OBJECT_NOT_FOUND');
                expect((e as DomainException).message).toContain('inputs/missing.mp4');
            }
        });

        it('should rethrow unexpected errors', async () => {
            const unexpectedError = new Error('Connection refused');
            mockSend.mockRejectedValueOnce(unexpectedError);

            await expect(service.headObject('inputs/test.mp4'))
                .rejects.toThrow('Connection refused');
        });
    });

    describe('getBucket', () => {
        it('should return the bucket name', () => {
            expect(service.getBucket()).toBe('vtaas-inputs');
        });
    });

    describe('deleteObject', () => {
        it('should delete object successfully', async () => {
            mockSend.mockResolvedValueOnce({});
            await service.deleteObject('my-bucket', 'my-key');
            expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
        });

        it('should silently succeed on NoSuchKey/404', async () => {
            const notFoundError = new Error('NoSuchKey');
            notFoundError.name = 'NoSuchKey';
            mockSend.mockRejectedValueOnce(notFoundError);
            
            await expect(service.deleteObject('my-bucket', 'my-key')).resolves.not.toThrow();
        });

        it('should rethrow unexpected errors', async () => {
            const unexpectedError = new Error('Connection refused');
            mockSend.mockRejectedValueOnce(unexpectedError);
            
            await expect(service.deleteObject('my-bucket', 'my-key')).rejects.toThrow('Connection refused');
        });
    });

    describe('getDownloadUrl', () => {
        it('should return a presigned GET URL', async () => {
            const url = await service.getDownloadUrl('vtaas-outputs', 'outputs/job-123/720p.mp4');

            expect(url).toBe('https://presigned-url.example.com');
        });

        it('should accept a custom expiresIn parameter', async () => {
            const url = await service.getDownloadUrl('vtaas-outputs', 'outputs/job-123/720p.mp4', 7200);

            expect(url).toBe('https://presigned-url.example.com');
        });
    });
});

