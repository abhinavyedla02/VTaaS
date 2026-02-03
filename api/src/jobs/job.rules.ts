import { JobStatus } from '@prisma/client';
import { DomainException } from '../common/exceptions';

/**
 * Allowed job status transitions.
 * Key: current status, Value: set of valid next statuses.
 */
const VALID_TRANSITIONS: Record<JobStatus, Set<JobStatus>> = {
    [JobStatus.PENDING]: new Set([JobStatus.PROCESSING]),
    [JobStatus.PROCESSING]: new Set([JobStatus.SUCCEEDED, JobStatus.FAILED]),
    [JobStatus.SUCCEEDED]: new Set(),
    [JobStatus.FAILED]: new Set(),
};

/**
 * Validates that a job status transition is allowed.
 * This is a pure function containing domain logic only.
 *
 * @param current - The current status of the job
 * @param next - The desired next status
 * @throws DomainException with code INVALID_JOB_TRANSITION if transition is invalid
 */
export function validateJobTransition(
    current: JobStatus,
    next: JobStatus,
): void {
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.has(next)) {
        throw new DomainException(
            'INVALID_JOB_TRANSITION',
            `Cannot transition job status from ${current} to ${next}`,
        );
    }
}
