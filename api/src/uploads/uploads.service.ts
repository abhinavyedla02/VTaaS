import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service } from '../common/s3/s3.service';
import { validateMimeType, validateSize, DEFAULT_MAX_UPLOAD_SIZE } from './upload.rules';

const DEFAULT_UPLOAD_EXPIRY = 900; // 15 minutes (D-010)

export interface UploadUrlResponse {
    url: string;
    inputKey: string;
    expiresIn: number;
}

@Injectable()
export class UploadsService {
    constructor(private readonly s3Service: S3Service) { }

    async generateUploadUrl(
        mimeType: string,
        sizeBytes: number,
    ): Promise<UploadUrlResponse> {
        // Read config from env (with safe NaN handling)
        const maxSize = this.getMaxUploadSize();
        const expiresIn = this.getUploadExpiry();

        // Validate using pure functions from 3.2.1
        const ext = validateMimeType(mimeType);
        validateSize(sizeBytes, maxSize);

        // Generate UUID-based key (D-006)
        const inputKey = `inputs/${randomUUID()}.${ext}`;

        // Get presigned URL from S3Service
        const url = await this.s3Service.getPresignedPutUrl(inputKey, mimeType, expiresIn);

        return { url, inputKey, expiresIn };
    }

    private getMaxUploadSize(): number {
        const envValue = process.env.MAX_UPLOAD_SIZE_BYTES;
        if (!envValue) return DEFAULT_MAX_UPLOAD_SIZE;
        const parsed = parseInt(envValue, 10);
        return isNaN(parsed) ? DEFAULT_MAX_UPLOAD_SIZE : parsed;
    }

    private getUploadExpiry(): number {
        const envValue = process.env.UPLOAD_EXPIRY_SECONDS;
        if (!envValue) return DEFAULT_UPLOAD_EXPIRY;
        const parsed = parseInt(envValue, 10);
        return isNaN(parsed) ? DEFAULT_UPLOAD_EXPIRY : parsed;
    }
}
