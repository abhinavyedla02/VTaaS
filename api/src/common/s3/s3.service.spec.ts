import { S3Service } from './s3.service';
import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    PutBucketCorsCommand,
} from '@aws-sdk/client-s3';

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

    describe('getBucket', () => {
        it('should return the bucket name', () => {
            expect(service.getBucket()).toBe('vtaas-inputs');
        });
    });
});
