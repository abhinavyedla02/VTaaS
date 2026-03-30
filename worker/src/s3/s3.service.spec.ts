import { WorkerS3Service } from './s3.service';
import {
    S3Client,
    HeadBucketCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    GetObjectCommand,
    PutObjectCommand,
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

describe('WorkerS3Service', () => {
    let service: WorkerS3Service;
    let mockSend: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new WorkerS3Service();
        mockSend = service.getClient().send as jest.Mock;
    });

    describe('onModuleInit (bucket creation)', () => {
        beforeEach(() => {
            // onModuleInit only creates buckets when AWS_ENDPOINT_URL is set (LocalStack)
            process.env.AWS_ENDPOINT_URL = 'http://localstack:4566';
            // Re-instantiate service so constructor picks up the env
            service = new WorkerS3Service();
            mockSend = service.getClient().send as jest.Mock;
        });

        afterEach(() => {
            delete process.env.AWS_ENDPOINT_URL;
        });
        it('should skip creation if vtaas-outputs bucket already exists', async () => {
            mockSend.mockResolvedValueOnce({}); // HeadBucket succeeds

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(1);
            expect(mockSend).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
        });

        it('should create vtaas-outputs bucket if it does not exist', async () => {
            const notFoundError = new Error('NotFound');
            notFoundError.name = 'NotFound';
            mockSend
                .mockRejectedValueOnce(notFoundError) // HeadBucket fails
                .mockResolvedValueOnce({}); // CreateBucket succeeds

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(2);
            expect(mockSend).toHaveBeenNthCalledWith(1, expect.any(HeadBucketCommand));
            expect(mockSend).toHaveBeenNthCalledWith(2, expect.any(CreateBucketCommand));
        });

        it('should handle 404 httpStatusCode (not just error.name)', async () => {
            const httpError = new Error('bucket not found');
            (httpError as unknown as Record<string, unknown>).$metadata = { httpStatusCode: 404 };
            mockSend
                .mockRejectedValueOnce(httpError)
                .mockResolvedValueOnce({});

            await service.onModuleInit();

            expect(mockSend).toHaveBeenCalledTimes(2);
        });

        it('should rethrow unexpected errors', async () => {
            const unexpectedError = new Error('Connection refused');
            mockSend.mockRejectedValueOnce(unexpectedError);

            await expect(service.onModuleInit()).rejects.toThrow('Connection refused');
        });
    });

    describe('getObject', () => {
        it('should download and return a Buffer', async () => {
            const testData = Buffer.from('video-data-here');
            mockSend.mockResolvedValueOnce({
                Body: {
                    transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(testData)),
                },
            });

            const result = await service.getObject('vtaas-inputs', 'inputs/abc.mp4');

            expect(result).toBeInstanceOf(Buffer);
            expect(result.toString()).toBe('video-data-here');
            expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
        });
    });

    describe('putObject', () => {
        it('should upload a Buffer to S3', async () => {
            mockSend.mockResolvedValueOnce({});

            const body = Buffer.from('output-video-data');
            await service.putObject('vtaas-outputs', 'outputs/job-1/720p.mp4', body, 'video/mp4');

            expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
            const command = mockSend.mock.calls[0][0] as PutObjectCommand;
            expect(command.input.Bucket).toBe('vtaas-outputs');
            expect(command.input.Key).toBe('outputs/job-1/720p.mp4');
            expect(command.input.ContentType).toBe('video/mp4');
        });
    });

    describe('headObject (dedupe-safe)', () => {
        it('should return metadata when object exists', async () => {
            mockSend.mockResolvedValueOnce({
                ContentLength: 50000,
                ContentType: 'video/mp4',
            });

            const result = await service.headObject('vtaas-outputs', 'outputs/job-1/720p.mp4');

            expect(result).toEqual({ size: 50000, contentType: 'video/mp4' });
            expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
        });

        it('should return null (not throw) when object is not found', async () => {
            const notFoundError = new Error('NotFound');
            notFoundError.name = 'NotFound';
            mockSend.mockRejectedValueOnce(notFoundError);

            const result = await service.headObject('vtaas-outputs', 'outputs/job-1/720p.mp4');

            expect(result).toBeNull();
        });

        it('should return null for 404 httpStatusCode', async () => {
            const httpError = new Error('not found');
            (httpError as unknown as Record<string, unknown>).$metadata = { httpStatusCode: 404 };
            mockSend.mockRejectedValueOnce(httpError);

            const result = await service.headObject('vtaas-outputs', 'outputs/job-1/720p.mp4');

            expect(result).toBeNull();
        });

        it('should rethrow unexpected errors', async () => {
            const unexpectedError = new Error('Access Denied');
            mockSend.mockRejectedValueOnce(unexpectedError);

            await expect(
                service.headObject('vtaas-outputs', 'outputs/job-1/720p.mp4'),
            ).rejects.toThrow('Access Denied');
        });

        it('should handle missing ContentLength/ContentType gracefully', async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await service.headObject('vtaas-outputs', 'outputs/job-1/720p.mp4');

            expect(result).toEqual({ size: 0, contentType: 'unknown' });
        });
    });

    describe('getOutputBucket', () => {
        it('should return vtaas-outputs', () => {
            expect(service.getOutputBucket()).toBe('vtaas-outputs');
        });
    });
});
