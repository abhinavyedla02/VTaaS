import { JobStatus } from '@prisma/client';
import { InvalidTransitionError } from './errors';
import { validateJobTransition, buildOutputKey } from './job.rules';

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
                    InvalidTransitionError,
                );
            },
        );

        it('should throw with INVALID_JOB_TRANSITION code', () => {
            try {
                validateJobTransition(
                    JobStatus.PROCESSING,
                    JobStatus.PENDING,
                );
                fail('Expected InvalidTransitionError to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidTransitionError);
                expect((error as InvalidTransitionError).code).toBe(
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
                fail('Expected InvalidTransitionError to be thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidTransitionError);
                expect((error as InvalidTransitionError).message).toContain('SUCCEEDED');
                expect((error as InvalidTransitionError).message).toContain('PENDING');
            }
        });
    });
});

describe('buildOutputKey', () => {
    it('should build deterministic output key per D-006', () => {
        expect(buildOutputKey('abc-123', '720p')).toBe('outputs/abc-123/720p.mp4');
    });

    it('should handle different profiles', () => {
        expect(buildOutputKey('job-id', '1080p')).toBe('outputs/job-id/1080p.mp4');
    });
});
