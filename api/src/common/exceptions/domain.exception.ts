import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception class for domain-specific errors.
 * Provides typed error codes for downstream consumers.
 */
export class DomainException extends HttpException {
    constructor(
        public readonly code: string,
        message: string,
        status: HttpStatus = HttpStatus.BAD_REQUEST,
    ) {
        super({ message, code }, status);
    }
}
