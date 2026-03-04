/**
 * Framework-agnostic error for invalid job status transitions.
 * Used in the shared packages/db so it doesn't depend on NestJS.
 * Each consuming app (api, worker) can catch this and wrap in their own HTTP/domain exception.
 */
export class InvalidTransitionError extends Error {
    public readonly code = 'INVALID_JOB_TRANSITION';

    constructor(from: string, to: string) {
        super(`Cannot transition job status from ${from} to ${to}`);
        this.name = 'InvalidTransitionError';
    }
}
