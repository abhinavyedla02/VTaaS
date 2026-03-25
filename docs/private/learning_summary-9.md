# VTaaS Learning Summary — Issue 9 (Job Polling + Video Player + Resolution Selector)

> This document covers the full polling/playback implementation and the 
> resolution selector feature. Written for interview prep — each section has 
> a one-liner, key concepts, hard-way lessons, and Q&A.

---

## Section 1: What We Built

### API Enhancements
1. **Presigned GET URLs** — Added `S3Service.getDownloadUrl(bucket, key, expiresIn)` 
   using `GetObjectCommand` + `@aws-sdk/s3-request-presigner`. Same presigner 
   used for PUT URLs, just a different command.
2. **Enriched job response** — `GET /api/jobs/:id` now includes `downloadUrl` 
   (presigned GET, 15-minute TTL) when status is `SUCCEEDED` and `outputKeys` 
   is non-empty. For other states, `downloadUrl` is `null`.
3. **Resolution validation** — `CreateJobDto.resolution` is `@IsOptional()` with 
   `@IsIn(['240p','360p','480p','720p','1080p'])`. Default is `720p` in the 
   service layer, not the DTO (keeps backward compatibility).

### Frontend Rewrite (DemoWidget)
4. **Polling loop** — `setInterval` at 2s, interval ID stored in `useRef<number | null>`. 
   `startPolling(jobId)` callback starts it, `stopPolling()` clears it. `useEffect` 
   cleanup calls `stopPolling` on unmount.
5. **State machine** — Status type: `idle | requesting | uploading | creating-job | 
   polling | succeeded | failed | error`. Each maps to a UI phase (form, progress, 
   result).
6. **Video player** — On `SUCCEEDED`, renders `<video>` with `controls` and 
   presigned GET URL as `src`. Download button opens the URL in a new tab.
7. **Resolution selector** — `<select>` dropdown (240p–1080p, default 720p). 
   Resolution flows into `POST /api/jobs` body and is used in the download 
   button label ("Download 480p").

### Worker Updates
8. **Profile-to-scale map** — `FfmpegService` replaced the hardcoded `720p` guard 
   with a `PROFILE_SCALE_HEIGHT` lookup. Adding a new resolution is a one-line 
   data change.

### The One-Liner
*"I added real-time polling with a proper cleanup pattern, a video player with 
presigned GET URLs, and a resolution selector that threads a user choice through 
four layers — React, NestJS, SQS, and ffmpeg — without a schema migration."*

---

## Section 2: Key Technical Decisions

### D-028: Enrich the existing endpoint, not a new one

**Options considered:**
- (A) New `GET /api/jobs/:id/output` endpoint
- (B) Add `downloadUrl` to existing `GET /api/jobs/:id` response

**Why B:** The frontend is already polling `/api/jobs/:id`. When it sees 
`SUCCEEDED`, the presigned URL is right there — no extra request, no "succeeded 
but loading URL…" flash state. One response, one state transition.

### D-029: useRef for interval cleanup

**The trap:** Using `useEffect` with `status` as a dependency creates a new 
interval on every status change. You end up with N intervals running 
simultaneously, each unaware of the others.

**The fix:** `useRef` holds the interval ID outside the React render cycle. 
One `setInterval`, one `clearInterval`, one ref. The `useEffect` cleanup is 
just insurance — it calls `stopPolling` on unmount.

```typescript
const pollRef = useRef<number | null>(null);

const stopPolling = useCallback(() => {
  if (pollRef.current !== null) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }
}, []);

useEffect(() => () => stopPolling(), [stopPolling]);
```

### D-030: Resolution flows through SQS, not the database

**Considered:** Adding a `resolution` column to the jobs table.

**Rejected:** The resolution is a transient input. Once the worker produces 
the output, the resolution is encoded in the output key (`outputs/{jobId}/480p.mp4`) 
and stored in `outputKeys`. Adding a column for something already captured 
in the output would be redundant. No migration, no index, no query complexity.

---

## Section 3: What Went Wrong / Lessons Learned

### The `isTerminal` type narrowing bug

**What happened:** TypeScript gave a lint error: `status === 'error'` comparison 
is impossible within the `showUploadForm` block. Why? Because `isTerminal` included 
`'error'`, and `showUploadForm = !isPolling && !isTerminal`. TypeScript correctly 
narrowed: if `showUploadForm` is true, status can't be `'error'`.

But `'error'` is a client-side validation state (file too large, wrong type) 
that should keep showing the upload form. It's not a terminal state from 
polling — it's a local validation result.

**The fix:** Removed `'error'` from `isTerminal`. Terminal states are only 
`succeeded` and `failed` (from the API). Now validation errors correctly 
show the form with the error message.

**Lesson:** TypeScript's type narrowing catches real logic bugs. When the 
compiler says "this comparison is impossible," it usually means your type 
unions don't model the domain correctly. Fix the types, not the comparison.

### Docker cache hiding code changes

**What happened:** `docker compose up --build` showed all layers as `CACHED` 
even though the API source files had changed. The old API code (without 
`downloadUrl`) was still running inside the container.

**The fix:** `docker compose build --no-cache api` forced a full rebuild. 
The web container had the same issue — it doesn't volume-mount source, so 
it also needed a rebuild.

**Lesson:** Docker layer caching can be deceptive. When testing code changes 
inside Docker, always check that the build step for the COPY layer actually 
ran (not CACHED). Or use `--no-cache` when verifying new code.

### Vite proxy target breaks on host

**What happened:** `vite.config.ts` has `proxy: { '/api': { target: 'http://api:3000' } }`. 
This works inside Docker Compose (Docker DNS resolves `api`), but fails when 
running `npm run dev` on the host machine.

**Root cause:** The web container doesn't volume-mount source — it copies at 
build time. For local frontend development, you'd need to change the proxy 
target to `http://localhost:3000`.

**Lesson:** Document the supported dev workflow clearly. If Docker Compose is 
the primary workflow, say so. If host-side `npm run dev` should work, the 
proxy target needs environment-aware configuration.

---

## Section 4: Interview Q&A

### Q: "How does the polling work? What happens on unmount?"

*"The DemoWidget uses `setInterval` at 2-second intervals to poll `GET /api/jobs/:id`. 
The interval ID is stored in a `useRef` — not state — because changing it shouldn't 
trigger a re-render. When the response comes back with `SUCCEEDED` or `FAILED`, the 
callback calls `clearInterval` and updates the component state. There's also a 
`useEffect` cleanup that runs `stopPolling` on unmount as a safety net. This prevents 
orphaned intervals if the user navigates away mid-poll."*

### Q: "Why enrich the existing endpoint instead of creating a separate download endpoint?"

*"The frontend is already polling `GET /api/jobs/:id` every 2 seconds. When it sees 
`SUCCEEDED`, it needs the presigned URL immediately to render the video player. If 
the URL were on a separate endpoint, you'd have a flash state — 'succeeded but still 
loading the URL' — and an extra network request. By including `downloadUrl` in the 
same response as the status, the transition is atomic: one response changes the state 
from 'polling' to 'playing video'."*

### Q: "How does the resolution selector work end-to-end?"

*"The user picks a resolution from a dropdown. The frontend sends it as `resolution` 
in the `POST /api/jobs` body. The API validates it via `@IsIn` — only 240p through 
1080p allowed, defaults to 720p. The service puts the resolution into the SQS message 
payload as a profile string. The worker's `FfmpegService` has a lookup map that maps 
profile names to ffmpeg scale heights — '480p' becomes `-vf scale=-2:480`. The output 
key uses the actual resolution, so you get `outputs/{jobId}/480p.mp4`. No database 
schema change — the resolution is transient, and the output key already captures what 
was produced."*

### Q: "What's the difference between client-side error states and server-side failure?"

*"There are two error paths. Client-side: if the file is too large or the wrong type, 
the `validateFile` function returns an error string immediately. The status goes to 
`'error'`, the message shows the problem, and the upload form stays visible so the 
user can pick a different file. Server-side: if the worker fails (ffmpeg error, 
duration too long), the job status becomes `FAILED` with an error message in the DB. 
The polling detects this in the `GET` response and shows the 'Try Again' button. 
These are different states — `error` is local and recoverable without a server round-trip; 
`failed` is a terminal state from the pipeline."*

---

## Section 5: Code References

| File | Why |
|------|-----|
| `api/src/common/s3/s3.service.ts` | `getDownloadUrl` — presigned GET URL generation |
| `api/src/jobs/jobs.service.ts` | `findById` enrichment with `downloadUrl`; `createJob` with resolution |
| `api/src/jobs/dto/create-job.dto.ts` | `@IsIn` validation for resolution |
| `web/src/components/DemoWidget.tsx` | Polling loop, video player, resolution dropdown, state machine |
| `web/src/components/DemoWidget.css` | Video player styles, pulsing step indicator, action buttons |
| `worker/src/transcode/ffmpeg.service.ts` | `PROFILE_SCALE_HEIGHT` lookup map |
| `docs/DECISIONS.md` | D-028 through D-030 — all Issue 9 decisions |
