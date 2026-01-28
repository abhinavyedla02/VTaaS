import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception';

describe('DomainException', () => {
    it('should create exception with code and message', () => {
        const exception = new DomainException('INVALID_TRANSITION', 'Cannot transition from PENDING to FAILED');

        expect(exception.code).toBe('INVALID_TRANSITION');
        expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);

        const response = exception.getResponse() as { message: string; code: string };
        expect(response.message).toBe('Cannot transition from PENDING to FAILED');
        expect(response.code).toBe('INVALID_TRANSITION');
    });

    it('should allow custom HTTP status', () => {
        const exception = new DomainException('NOT_FOUND', 'Job not found', HttpStatus.NOT_FOUND);

        expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('should default to BAD_REQUEST status', () => {
        const exception = new DomainException('VALIDATION_ERROR', 'Invalid input');

        expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
});
