import { JobStatus } from '@prisma/client';
import { InvalidTransitionError } from './errors';

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
 * @throws InvalidTransitionError if transition is invalid
 */
export function validateJobTransition(
    current: JobStatus,
    next: JobStatus,
): void {
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.has(next)) {
        throw new InvalidTransitionError(current, next);
    }
}

/**
 * Builds the deterministic S3 output key for a transcode profile.
 * Locked per D-006: outputs/{jobId}/{profile}.mp4
 */
export function buildOutputKey(jobId: string, profile: string): string {
    return `outputs/${jobId}/${profile}.mp4`;
}
