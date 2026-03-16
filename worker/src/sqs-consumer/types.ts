/**
 * SQS message payload for transcode jobs.
 * Local copy — NOT imported from the API (separate deployment boundary).
 * Locked per D-007.
 */
export interface TranscodePayload {
    jobId: string;
    inputKey: string;
    profiles: string[];
}
