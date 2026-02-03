import { JobStatus } from '@prisma/client';
import { DomainException } from '../common/exceptions';
import { validateJobTransition } from './job.rules';

describe('validateJobTransition', () => {
    describe('valid transitions', () => {
        it('should allow PENDING -> PROCESSING', () => {
            expect(() =>
                validateJobTransition(JobStatus.PENDING, JobStatus.PROCESSING),
            ).not.toThrow();
        });

        it('should allow PROCESSING -> SUCCEEDED', () => {
            expect(() =>
                validateJobTransition(
                    JobStatus.PROCESSING,
                    JobStatus.SUCCEEDED,
                ),
            ).not.toThrow();
        });

        it('should allow PROCESSING -> FAILED', () => {
            expect(() =>
                validateJobTransition(JobStatus.PROCESSING, JobStatus.FAILED),
            ).not.toThrow();
        });
    });

    describe('invalid transitions', () => {
        const invalidCases: [JobStatus, JobStatus][] = [
            // Cannot go backwards
            [JobStatus.PROCESSING, JobStatus.PENDING],
            [JobStatus.SUCCEEDED, JobStatus.PENDING],
            [JobStatus.SUCCEEDED, JobStatus.PROCESSING],
            [JobStatus.FAILED, JobStatus.PENDING],
            [JobStatus.FAILED, JobStatus.PROCESSING],
            // Cannot skip states
            [JobStatus.PENDING, JobStatus.SUCCEEDED],
            [JobStatus.PENDING, JobStatus.FAILED],
            // Terminal states cannot transition to each other
            [JobStatus.SUCCEEDED, JobStatus.FAILED],
            [JobStatus.FAILED, JobStatus.SUCCEEDED],
            // Cannot transition to same state
            [JobStatus.PENDING, JobStatus.PENDING],
            [JobStatus.PROCESSING, JobStatus.PROCESSING],
            [JobStatus.SUCCEEDED, JobStatus.SUCCEEDED],
            [JobStatus.FAILED, JobStatus.FAILED],
        ];

        it.each(invalidCases)(
            'should throw on %s -> %s',
            (current, next) => {
                expect(() => validateJobTransition(current, next)).toThrow(
                    DomainException,
                );
            },
        );

        it('should throw with INVALID_JOB_TRANSITION code', () => {
            try {
                validateJobTransition(
                    JobStatus.PROCESSING,
                    JobStatus.PENDING,
                );
                fail('Expected DomainException to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(DomainException);
                expect((error as DomainException).code).toBe(
                    'INVALID_JOB_TRANSITION',
                );
            }
        });

        it('should include from/to statuses in error message', () => {
            try {
                validateJobTransition(
                    JobStatus.SUCCEEDED,
                    JobStatus.PENDING,
                );
                fail('Expected DomainException to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(DomainException);
                const response = (error as DomainException).getResponse() as {
                    message: string;
                };
                expect(response.message).toContain('SUCCEEDED');
                expect(response.message).toContain('PENDING');
            }
        });
    });
});
