/**
 * Supported transcode resolutions.
 * Single source of truth — imported by API (DTO validation), worker (ffmpeg), and frontend (dropdown).
 * Kept in a separate file to avoid pulling in @prisma/client transitively.
 */
export const SUPPORTED_RESOLUTIONS = ['240p', '360p', '480p', '720p', '1080p'] as const;
export type Resolution = (typeof SUPPORTED_RESOLUTIONS)[number];
