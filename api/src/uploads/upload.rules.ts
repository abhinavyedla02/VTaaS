import { DomainException } from '../common/exceptions';

/**
 * Mime type allowlist from D-009.
 * Maps allowed mime types to their file extensions.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
};

/**
 * Default max upload size from D-010.
 * 500MB in bytes.
 */
export const DEFAULT_MAX_UPLOAD_SIZE = 524288000;

/**
 * Validates that a mime type is in the allowlist.
 * Returns the file extension for the mime type.
 *
 * @param mimeType - The mime type to validate
 * @returns The file extension (e.g., 'mp4')
 * @throws DomainException with code UNSUPPORTED_MIME_TYPE if not allowed
 */
export function validateMimeType(mimeType: string): string {
    const ext = MIME_TO_EXTENSION[mimeType];
    if (!ext) {
        throw new DomainException(
            'UNSUPPORTED_MIME_TYPE',
            `Mime type '${mimeType}' is not supported. Allowed: video/mp4, video/quicktime, video/webm`,
        );
    }
    return ext;
}

/**
 * Validates that file size is within the limit.
 * Pure function — limit is passed in, not read from env.
 *
 * @param sizeBytes - The file size in bytes
 * @param limit - The maximum allowed size (default: 500MB)
 * @throws DomainException with code FILE_TOO_LARGE if size exceeds limit
 */
export function validateSize(
    sizeBytes: number,
    limit: number = DEFAULT_MAX_UPLOAD_SIZE,
): void {
    if (sizeBytes > limit) {
        throw new DomainException(
            'FILE_TOO_LARGE',
            `File size ${sizeBytes} bytes exceeds the limit of ${limit} bytes`,
        );
    }
}

/**
 * Gets the file extension for a mime type without throwing.
 * Returns undefined if the mime type is not in the allowlist.
 *
 * @param mimeType - The mime type to look up
 * @returns The file extension or undefined
 */
export function getExtensionForMimeType(mimeType: string): string | undefined {
    return MIME_TO_EXTENSION[mimeType];
}
