
---

## `docs/DECISIONS.md`

```markdown
# Decisions (ADR-lite)

## How to use this file
- This file records decisions that affect multiple parts of the system.
- Each decision includes: status, rationale, and consequence.
- If a decision changes, update it via PR and include the reason.

---

## D-001: NestJS + Fastify for API
- **Status:** Decided (implemented)
- **Rationale:** Current API is NestJS and explicitly uses the Fastify adapter.
- **Consequence:** API patterns should follow NestJS + Fastify conventions; avoid introducing Express-specific middleware assumptions.

---

## D-002: Local-first development via Docker Compose
- **Status:** Decided (implemented)
- **Rationale:** Compose provides consistent local orchestration of API + DB + LocalStack.
- **Consequence:** All Phase 0 functionality must be runnable via `docker compose up`.

---

## D-003: AWS emulation via LocalStack (S3 + SQS) in Phase 0
- **Status:** Decided (implemented for service availability; integration planned)
- **Rationale:** Provides local equivalents for storage and queue without AWS usage.
- **Consequence:** API/worker AWS clients must support LocalStack endpoint configuration.

---

## D-004: Phase 0 uses `user_id` as NOT NULL (dev stub)
- **Status:** Decided
- **Rationale:** Phase 0 idempotency is defined as unique `(user_id, input_key)`. If `user_id` is nullable, Postgres uniqueness allows multiple NULLs, breaking idempotency.
- **Consequence:** Phase 0 job creation must always resolve a non-null user id (env-based dev user is acceptable until auth exists).

---

## D-005: Upload mechanism in Phase 0 uses presigned PUT
- **Status:** Decided
- **Rationale:** Presigned PUT is simplest for Phase 0 pipeline wiring and testing.
- **Consequence:**
  - Content-Type can be enforced by signing required headers.
  - Size enforcement is "validate before issuing URL" and must be verified (e.g. HEAD) before job creation/enqueue.

---

## D-006: Canonical object key scheme
- **Status:** Decided
- **Inputs:** `inputs/{uuid}.{ext}`
- **Outputs:** `outputs/{jobId}/{profile}.mp4`
- **Rationale:** Deterministic keys simplify retries, idempotency, cleanup, and debugging.
- **Consequence:** API/worker/web must treat keys as contract; changes require versioning and documentation.

---

## D-007: SQS message schema includes `profiles` from v0
- **Status:** Decided
- **Schema (v0):**
```json
{
  "jobId": "<uuid>",
  "inputKey": "inputs/<uuid>.<ext>",
  "profiles": ["720p"]
}
```

---

## D-008: Logging v0 schema (structured JSON request logs)
- **Status:** Decided (not implemented)
- **Schema (exact):** `{ level, msg, requestId, path, method }`
- **Optional behavior:** If client sends `x-request-id` header, use it as `requestId`; otherwise generate UUID.
- **Rationale:** Structured logs enable parsing and observability. Minimal schema for Phase 0.
- **Consequence:** All request logs must include these exact fields. Implementation must use this schema. See `docs/ARCHITECTURE.md` API section for reference.

---

## D-009: Mime type allowlist and extension mapping
- **Status:** Decided (implemented in `upload.rules.ts`)
- **Allowlist (Phase 0):**
  | Mime Type | Extension |
  |-----------|-----------|
  | `video/mp4` | `mp4` |
  | `video/quicktime` | `mov` |
  | `video/webm` | `webm` |
- **Rationale:** Strict allowlist prevents unexpected file types; mapping ensures consistent S3 key extensions.
- **Consequence:** 
  - API rejects upload requests with unsupported mime types (`UNSUPPORTED_MIME_TYPE` error code)
  - Worker can expect only these extensions in input keys
  - Expand allowlist via PR when needed

---

## D-010: Upload size and URL expiry limits
- **Status:** Decided (partially implemented — size validation in `upload.rules.ts`, URL expiry in 3.2.2)
- **Limits (Phase 0):**
  | Limit | Env Var | Default |
  |-------|---------|---------|
  | Max file size | `MAX_UPLOAD_SIZE_BYTES` | `524288000` (500MB) |
  | Presigned URL expiry | `UPLOAD_EXPIRY_SECONDS` | `900` (15min) |
- **Rationale:** Reasonable defaults for local dev; configurable for staging/prod.
- **Consequence:**
  - API rejects upload requests exceeding size limit (`FILE_TOO_LARGE` error code)
  - Presigned URLs expire after configured duration
  - HEAD check before job creation verifies actual uploaded size

---

## D-011: SQS queue configuration (Phase 0)
- **Status:** Decided (implemented in `sqs.service.ts`)
- **Queues:**
  | Queue | Purpose |
  |-------|---------|
  | `transcode-jobs` | Main job queue consumed by worker |
  | `transcode-jobs-dlq` | Dead-letter queue for failed messages |
- **Attributes:**
  | Attribute | Value | Rationale |
  |-----------|-------|-----------|
  | `VisibilityTimeout` | `300` (5min) | Video processing takes significant time; default 30s would cause duplicate processing |
  | `maxReceiveCount` | `3` | Messages move to DLQ after 3 failed processing attempts |
- **Consequence:**
  - Queue creation is idempotent (`CreateQueueCommand` returns existing URL)
  - DLQ must be created before main queue (ARN needed for RedrivePolicy)
  - Worker must complete processing within 5 minutes or extend visibility

---

## D-012: LocalStack-first development & deployment strategy
- **Status:** Decided
- **Context:** Using `@aws-sdk/client-s3` and `@aws-sdk/client-sqs` with `AWS_ENDPOINT_URL` pointing to LocalStack means the NestJS application code is cloud-agnostic. Removing `AWS_ENDPOINT_URL` and providing real IAM credentials is the only change required to target real AWS.
- **Decision:**
  - Develop locally against LocalStack through Phase 5 (end-to-end working system)
  - Complete Phase 6 (Guardrails: file size limits, rate limiting, cleanup) before any public deployment
  - Infrastructure (S3 buckets, SQS queues, database) must be provisioned separately in production — `docker-compose.yml` is local-only
- **Rationale:**
  - Internet bots scan all public IPs within hours; an unprotected transcoding API would allow unbounded uploads and FFmpeg jobs, causing runaway cloud bills
  - "Security by obscurity" (not sharing the URL) is not a valid defense — automated scanners find exposed services without needing a link
  - LocalStack provides free, fast iteration; real AWS adds deployment latency and cost during active development
- **Consequence:**
  - No public deployment until Phase 6 is complete
  - If early AWS testing is desired, lock the API behind a hardcoded `API_KEY` header until guardrails exist
  - Production database should use a managed service with a free tier (Neon, Supabase) over AWS RDS for portfolio cost efficiency

### D-013 — Shared Prisma Client via npm Workspaces
- **Context:** The Worker (Issue 5) needs to update job status in the same database as the API.
- **Decision:** Hoist `schema.prisma` and the generated Prisma client to a shared root package using npm workspaces. Both `api/` and `worker/` import the same typed client.
- **Alternatives rejected:**
  - Copy-paste Prisma folder into `worker/` — two sources of truth, schema drift guaranteed
  - Raw SQL in worker — loses type safety, migration tracking, and Prisma's generated types
- **Consequence:** Single schema, single migration history, zero drift between API and Worker.

### D-014 — FFmpeg Installation in Worker Dockerfile
- **Context:** The Worker needs to execute FFmpeg commands for video transcoding.
- **Decision:** Worker Dockerfile installs FFmpeg at the OS level (`apk add ffmpeg` for Alpine). Startup healthcheck verifies `ffmpeg -version` succeeds before accepting SQS messages.
- **Rationale:** FFmpeg does not exist in default Node.js Docker images. If the binary is missing, jobs will fail silently; a healthcheck makes this a loud, immediate failure.
- **Consequence:** Worker image will be larger than the API image (~100MB for FFmpeg).

### D-015 — SQS Long Polling (WaitTimeSeconds: 20)
- **Context:** Worker polls SQS for new transcode jobs.
- **Decision:** Configure `ReceiveMessageCommand` with `WaitTimeSeconds: 20`. Connection held open for up to 20 seconds; returns immediately if a message arrives.
- **Alternatives rejected:**
  - Short polling (default: `WaitTimeSeconds: 0`) — causes ~1,000 requests/second, burns CPU, generates massive AWS bills
- **Consequence:** ~3 requests/minute during idle periods. Near-instant response when jobs arrive.

### D-016 — API CORS (Deferred to Phase 4: Frontend)
- **Context:** Browser requests from the frontend (`localhost:5173`) to the API (`localhost:3000`) will be blocked by CORS policy.
- **Decision:** Defer `app.enableCors()` until Phase 4 (Frontend). Not a blocker for Phase 1 backend work.
- **Rationale:** Adding CORS now would be untestable without a frontend. We'll configure it with explicit origin restrictions when the frontend exists.
- **Consequence:** `curl` and integration scripts are unaffected; only browser requests need CORS.

---

### D-017 — `@vtaas/db` Compiled Entry Point (Docker Production)
- **Status:** Decided (implemented)
- **Context:** `packages/db/package.json` originally had `"main": "src/index.ts"`. This works for `ts-jest` (which handles `.ts` directly) but breaks Node at runtime in Docker — Node cannot execute `.ts` files.
- **Decision:**
  - `"main": "dist/index.js"` and `"types": "dist/index.d.ts"` in `packages/db/package.json`
  - `"build": "tsc"` script added to `packages/db`
  - Dockerfiles compile `@vtaas/db` in the **build stage only**: `RUN npm run build --workspace=@vtaas/db`
  - Runtime stage copies pre-compiled `dist/` from build stage: `COPY --from=build /app/packages/db/dist ./packages/db/dist`
- **Rationale:** Recompiling in the runtime stage fails because `devDependencies` (`@types/jest`) are excluded by `--omit=dev`, causing `tsc` to fail on spec files. The correct multi-stage pattern is compile once, copy the artifact.
- **Consequence:** Any change to `packages/db/src/` requires rebuilding the package locally (`npm run build --workspace=@vtaas/db`) before `tsc` resolves types in `api/` or `worker/`. Docker handles this automatically during `docker compose build`.

---

### D-018 — TOCTOU Race on Job Status Transition
- **Status:** Known limitation — Phase 0 acceptable, Phase 2 fix planned
- **Context:** `TranscodeService.processJob` uses a read-then-write pattern: `findUnique` → `validateJobTransition` → `job.update`. Two workers processing the same message simultaneously could both read `PENDING` and both attempt the `PENDING → PROCESSING` transition.
- **Why safe in Phase 0:** SQS `VisibilityTimeout: 300` prevents any second worker from seeing the message while the first is processing. Duplicate concurrent processing is practically impossible in single-worker deployments.
- **Phase 2 fix:** Replace with optimistic locking — `prisma.job.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PROCESSING' } })` and assert `count === 1`. If `count === 0`, another worker got there first; discard the message.
- **Consequence:** Acceptable risk in Phase 0. Must be addressed before scaling to multiple worker instances.

---

### D-019 — Worker SQS Consumer Fire-and-Forget Bootstrap
- **Status:** Decided (implemented)
- **Context:** `SqsConsumerService.onModuleInit()` must start an infinite polling loop without blocking NestJS module initialization.
- **Decision:** `void this.startPolling()` — intentional fire-and-forget. The `void` operator explicitly discards the returned `Promise`, signaling intent to any reader.
- **Rationale:** If `onModuleInit` awaited `startPolling()`, the NestJS bootstrap sequence would never complete — the app would hang indefinitely before becoming healthy.
- **Consequence:** Unhandled errors in the polling loop must be caught internally (they are — `poll()` has its own `try/catch`). The loop is self-contained and does not surface errors to the NestJS lifecycle.

### D-020: IP Rate Limiting Strategy
- Status: Decided (implemented)
- Package: @nestjs/throttler v6.5.0
- Config: 3 requests per hour per IP (ttl: 3600000ms, limit: 3)
- Applied to: POST /api/uploads and POST /api/jobs only
- NOT applied to: GET /api/health, GET /api/jobs/:id
- Storage: in-memory (acceptable for single-instance portfolio deployment)
- Known limitation: rate limit state resets on API restart
- Custom guard: FastifyThrottlerGuard extends ThrottlerGuard, overrides getTracker to read req.ip for Fastify compatibility

### D-021: Video Duration Limit
- Status: Decided (implemented)
- Check: ffprobe in worker, runs after S3 download, before ffmpeg
- Limit: MAX_VIDEO_DURATION_SECONDS env var (default: 60)
- Error code: VIDEO_TOO_LONG
- Fail-safe: ffprobe errors are swallowed — don't block valid videos
- Early return does NOT re-throw — SQS deletes the message (validation failure, not transient error)

### D-022: Ephemeral Data Cleanup
- Status: Decided (implemented)
- Package: @nestjs/schedule v6.1.1
- Schedule: hourly cron ('0 * * * *')
- Retention: 24 hours
- Scope: deletes S3 inputs + outputs first, then DB record
- Safety: skips PROCESSING jobs, idempotent on missing S3 objects
- Rationale: protect Neon free tier row limit + prevent S3 cost accumulation at portfolio scale

---

### D-023: Vanilla CSS Variables Over Tailwind
- **Status:** Decided (implemented)
- **Context:** Issue 8 needed a design system for the portfolio UI. Tailwind, CSS Modules, and vanilla CSS were all options.
- **Decision:** Vanilla CSS with custom properties (CSS variables) in `App.css`. One file defines all tokens (colors, spacing, typography, radii, transitions). Each component has a co-located `.css` file.
- **Alternatives rejected:**
  - Tailwind — adds a build dependency, config file, and class-name conventions for a project with 6 components. Overkill at this scale.
  - CSS Modules — scoping isn't a problem with 6 components that never share class names
- **Consequence:** Full control over the design system. No extra dependencies. Trade-off: no utility classes — all styles are written longhand.

### D-024: Google Fonts via CDN (Not npm)
- **Status:** Decided (implemented)
- **Context:** The portfolio uses Inter and JetBrains Mono fonts.
- **Decision:** Load via `<link>` tags in `index.html` pointing to Google Fonts CDN. Not installed as npm packages.
- **Rationale:** CDN fonts are not application dependencies — they're static asset links identical to loading from a self-hosted URL. Adding `@fontsource/inter` would increase bundle size and node_modules complexity for zero benefit.
- **Consequence:** Fonts require internet connectivity to load. Acceptable for a portfolio site.

### D-025: Two-Row SVG Diagram Layout
- **Status:** Decided (implemented — revised from initial single-row layout)
- **Context:** The initial diagram placed all 6 nodes in a single horizontal row with S3 and SQS branching vertically above/below. Edge labels ("presigned PUT", "PUT output", "GET input") overlapped nodes and each other because diagonal arrows created tight collision zones in an 850×160 SVG viewBox.
- **Decision:** Reorganized to a two-row layout (880×250 viewBox):
  - Top row: processing pipeline (Browser → API → SQS → Worker) with ~190px horizontal gaps
  - Bottom row: storage (S3 inputs, S3 outputs) vertically offset below
  - Vertical arrows between rows with label offset support (`labelDx`/`labelDy`) for fine positioning
- **Lesson learned:** For labeled graph visualizations, budget 2× the space you think you need. Edge labels need clear air on all sides — they can't share space with arrows or node borders.
- **Consequence:** Diagram is readable at a glance on 1440px screens. No horizontal scroll.

### D-026: Client-Side File Validation (Defense in Depth)
- **Status:** Decided (implemented)
- **Context:** The API already validates file type (D-009) and size (D-010) server-side. The question was whether to also validate client-side.
- **Decision:** Added client-side validation in `DemoWidget.tsx`:
  - Type check: `ACCEPTED_TYPES` Set matching the server allowlist (MP4, MOV, WebM)
  - Size check: `MAX_FILE_SIZE = 20 * 1024 * 1024` (20MB), matching production `MAX_UPLOAD_SIZE_BYTES`
- **Rationale:** Client-side validation gives instant feedback before a network round-trip. Server-side validation remains the authority — client-side is a UX optimization, not a security boundary.
- **Consequence:** Users see "File too large" or "Unsupported file type" immediately on file selection, without waiting for the presign request to fail.

### D-027: "Why This Exists" Framing Over Generic Badge
- **Status:** Decided (implemented — replaced initial "Portfolio Project" pill)
- **Context:** The initial Hero section had a "Portfolio Project" pill badge. During polish review, this framing was flagged as working against the goal — it signals "student project" rather than "intentional engineering."
- **Decision:** Removed the pill entirely. Added a dedicated "Why This Exists" section between Hero and Demo that explains the architectural intent in 3–4 sentences: presigned uploads keep files off the API, SQS decouples dispatch from processing, Worker runs in its own Fargate task.
- **Rationale:** Framing affects perception. A recruiter or engineer who reads "Portfolio Project" adjusts their expectations downward. One who reads "Every architectural decision has a reason" engages differently.
- **Consequence:** The page leads with technical intent rather than a label.

---

### D-028: Enrich GET /api/jobs/:id Response (Not a Separate Download Endpoint)
- **Status:** Decided (implemented)
- **Context:** The frontend needs a presigned GET URL for the output video when a job succeeds. Two options: (A) new `GET /api/jobs/:id/output` endpoint, or (B) append `downloadUrl` to the existing `GET /api/jobs/:id` response.
- **Decision:** Option B — enrich the existing response. When `status === SUCCEEDED` and `outputKeys` is non-empty, `JobsService.findById` generates a presigned GET URL via `S3Service.getDownloadUrl` and includes it as `downloadUrl`. For non-SUCCEEDED jobs, `downloadUrl` is `null`.
- **Rationale:** The frontend is already polling `GET /api/jobs/:id`. Having the presigned URL arrive in the same response as the `SUCCEEDED` status avoids an extra request and eliminates a "succeeded but loading URL…" flash state. One response, one state transition.
- **Consequence:** `S3Service` was injected into `JobsService` (already available — `S3Module` is `@Global()`). No new endpoint.

### D-029: Polling with useRef Cleanup Pattern
- **Status:** Decided (implemented)
- **Context:** The DemoWidget needs to poll `GET /api/jobs/:id` every 2 seconds until a terminal state. `setInterval` must be cleaned up on unmount or when polling stops.
- **Decision:** Store the interval ID in a `useRef<number | null>`, start polling via `setInterval` in a `startPolling` callback, stop via `clearInterval` in a `stopPolling` callback. A `useEffect` cleanup runs `stopPolling` on unmount.
- **Alternatives rejected:**
  - `setTimeout` chains — harder to cancel, requires tracking recursion
  - `useEffect` with `status` dependency — creates new intervals on every status change, causing leaks
- **Consequence:** Clean unmount behavior. No duplicate polls. Interval is cleared exactly once.

### D-030: Resolution Pipeline Without DB Schema Change
- **Status:** Decided (implemented)
- **Context:** The resolution selector lets users choose 240p–1080p output. The question was whether to store the selected resolution in the jobs table.
- **Decision:** No DB schema change. Resolution flows through the request only:
  1. Frontend sends `resolution` in `POST /api/jobs` body
  2. API validates via `@IsIn(['240p','360p','480p','720p','1080p'])` (default: 720p)
  3. Resolution is placed in the SQS message payload as a profile string
  4. Worker reads it from the message, maps to ffmpeg scale filter via `PROFILE_SCALE_HEIGHT` lookup
  5. Output key uses the resolution: `outputs/{jobId}/{resolution}.mp4`
  6. The resulting output key is stored in `outputKeys` (jsonb), which already captures what was produced
- **Rationale:** Adding a column for a transient UI preference that's already captured in the output key would be redundant. The `outputKeys` array tells you what resolution was produced.
- **Consequence:** If you need to query "all jobs transcoded at 1080p", you'd need to parse `outputKeys`. Acceptable at portfolio scale.

### D-031: Sample Video Fetched on Demand from S3
- **Status:** Decided (implemented)
- **Context:** Need a one-click demo for recruiters. Video could be bundled in the React build or hosted externally.
- **Decision:** Host in a dedicated S3 bucket (`vtaas-samples`), fetch on demand when user clicks the button. `VITE_SAMPLE_VIDEO_URL` env var makes it easy to swap between LocalStack (local) and a real S3/CloudFront URL (production).
- **Rationale:** Bundling ~5MB in the web build bloats every page load. Fetch-on-demand means zero bundle impact and the video still flows through the real pipeline.
- **Consequence:** Requires LocalStack seeding for local dev (`infra/localstack-init/seed-sample.sh`); production deploy needs the video uploaded to a public bucket or CDN.

### D-032: Frontend Dwell Time Buffering for Diagram Pacing
- **Status:** Decided (implemented)
- **Context:** Small videos transcode in 1–2 seconds, causing diagram highlights to flash by too fast for the viewer.
- **Decision:** Buffer status transitions on the frontend with a 1.5s minimum dwell per stage. Terminal states (`succeeded`/`failed`/`error`) bypass the buffer and apply immediately.
- **Rationale:** Purely visual — backend runs at full speed, UI paces the animation. No artificial backend delays, no polling changes.
- **Consequence:** None for backend. Users see each pipeline stage for at least 1.5s.

### D-033: Manual Diagram Progression Replaces Auto-Buffering
- **Status:** Decided (implemented, supersedes D-032)
- **Context:** Dwell-time auto-buffering (D-032) paced highlights automatically, but the timing felt passive and the user had no control. Small videos still flashed through stages.
- **Decision:** Replace auto-buffering with manual step-by-step progression. A "Next →" button lets the user advance the diagram stage. The button is disabled when the user has caught up to the real pipeline state. Terminal states auto-advance.
- **Rationale:** More engaging — turns the diagram into a guided architecture tour. Each click teaches the user what happens at that stage. Backend still runs at full speed; the diagram is a separate visual layer.
- **Consequence:** Requires the user to click through stages. Slightly more interactive effort, but much more educational. Also bumped throttle from 3/hr to 20/hr for better demo experience.

---

### D-034: Pre-Deployment Cleanup Scope
- **Status:** Decided (implemented)
- **Context:** Full codebase scan before Phase 4 identified 10 issues. Scoped a targeted cleanup to fix the items that would block or complicate AWS deployment, while deferring items that are safe in the current architecture.
- **Fixed:**
  1. **Hardcoded AWS credentials** — S3 and SQS clients in all 4 services now only set `credentials` when `AWS_ENDPOINT_URL` is present (LocalStack). When absent, the SDK uses the default credential provider chain (ECS task role, env vars).
  2. **S3 CORS wildcard** — `applyCorsRules()` now reads `CORS_ALLOWED_ORIGINS` env var. Falls back to `*` only when unset.
  3. **API-level CORS** — Added `app.enableCors()` in `main.ts`, driven by the same `CORS_ALLOWED_ORIGINS` env var.
  4. **SQS poison pill handling** — `JSON.parse` in the consumer now has its own try/catch. Unparseable messages are deleted immediately instead of retrying 3x.
  5. **Presigned URL rewrite** — Replaced hardcoded `localstack:4566` → `localhost:4566` swap with `VITE_S3_ENDPOINT` env var.
  6. **Resolution profile sync** — Exported `SUPPORTED_RESOLUTIONS` from `@vtaas/db`. API DTO and worker ffmpeg service import from the shared source of truth.
- **Intentionally deferred:**
  - **TOCTOU race (D-018):** Safe in Phase 0 — SQS VisibilityTimeout prevents concurrent processing. Fix with optimistic locking when scaling to multiple workers.
  - **Web Dockerfile (dev-only):** Phase 4 uses Vercel for frontend deployment, not containerized web. No action needed.
  - **Orphaned S3 cleanup:** Current DB-driven cleanup is sufficient at portfolio scale. S3 prefix scanning adds complexity without proportional benefit.
  - **ESLint:** `tsc --noEmit` with strict mode catches most issues. Adding ESLint is a new dependency and out of scope for this cleanup.
- **Consequence:** All env-var-driven changes follow the triple-update rule (DEVELOPMENT.md, docker-compose.yml, .env.example). No code changes needed at deploy time — configuration only.


---
## D-035: AWS Resources (us-east-1)

| Resource | Name/ARN | Notes |
|----------|----------|-------|
| ECR (API) | `<account>.dkr.ecr.us-east-1.amazonaws.com/vtaas-api` | |
| ECR (Worker) | `<account>.dkr.ecr.us-east-1.amazonaws.com/vtaas-worker` | |
| S3 (inputs) | `vtaas-inputs-<account>` | CORS enabled |
| S3 (outputs) | `vtaas-outputs-<account>` | CORS enabled |
| S3 (samples) | `vtaas-samples-<account>` | Presigned URL access |
| SQS (main) | `transcode-jobs` | VisibilityTimeout: 300s |
| SQS (DLQ) | `transcode-jobs-dlq` | maxReceiveCount: 3 |
| SSM | `/vtaas/DATABASE_URL` | SecureString, Neon connection |
| Neon | `vtaas-prod` | aws-us-east-1, free tier |

### D-036: Infra approach — CLI scripts over Terraform
Single-environment portfolio project. CLI scripts force understanding of 
every AWS primitive and are checked into infra/scripts/. Would use Terraform 
for multi-environment production.

### D-037: Worker always-on (for now)
Worker runs with desiredCount=1 (min=1) to avoid 2-3 minute cold start 
during demos. Scale-to-zero via step scaling + CloudWatch alarm on SQS 
queue depth is a planned optimization. Potential enhancement: pre-warm 
worker when page loads.

### D-038: Frontend deployment — standalone Vercel project
web/ deploys directly to Vercel as a standalone project page
(vtaas.yourdomain.com). It is already a complete, self-contained page
with Hero, DemoWidget, SystemDiagram, AboutStack, and WhatsNext sections.
When a broader developer portfolio site is built, it links to this URL —
no component embedding or cross-repo coupling.

---

### D-039: Docker images for Fargate must be built with --platform linux/amd64
- **Status:** Decided (lesson learned Phase 4 Session 3)
- **Context:** Mac Apple Silicon (M-series) defaults to `linux/arm64` when running `docker build`. ECS Fargate (x86) requires `linux/amd64`. The worker image pushed in Session 3 without the flag caused `CannotPullContainerError` on the first deployment attempt. The API image happened to be built correctly in Session 2.
- **Decision:** All `docker build` commands targeting ECR/Fargate must include `--platform linux/amd64`.
- **Canonical build command:**
  ```bash
  docker build --platform linux/amd64 -t <image> -f <service>/Dockerfile .
  ```
- **Consequence:** Build time increases slightly on Apple Silicon (cross-compilation via QEMU). Images will not run natively on the dev machine with `docker run` unless the flag is also passed there. For local development, omit the flag; for ECR pushes, always include it.

---

### D-040: s3:ListBucket required for HeadObject on non-existent keys; SDK v3 CRC64NVME default
- **Status:** Decided (lesson learned Phase 4 Session 3)
- **Context:** Two separate bugs surfaced during the first E2E test in AWS.

**Bug 1 — CRC64NVME checksum (UnknownError on GetObject)**
S3 now automatically stores `ChecksumCRC64NVME` on newly uploaded objects (new S3 data integrity default).
AWS SDK v3 defaults to `responseChecksumValidation: 'WHEN_SUPPORTED'`, which sends `x-amz-checksum-mode: ENABLED` on GET requests and attempts local CRC64NVME validation — a hash function not implemented in Node.js.
Result: `GetObjectCommand` throws `UnknownError` on every S3 download.
Fix: set `responseChecksumValidation: 'WHEN_REQUIRED'` on the S3Client. Applied in `worker/src/s3/s3.service.ts`.

**Bug 2 — s3:ListBucket missing → HeadObject returns 403 instead of 404**
AWS S3 intentionally returns `403 Forbidden` (not `404 Not Found`) on `HeadObject` calls to non-existent keys when the caller lacks `s3:ListBucket` permission. This prevents key enumeration by unauthorized callers.
Local dev used admin credentials (full s3:*), so `HeadObject` on missing keys returned 404 normally.
The ECS task role had `s3:HeadObject` but not `s3:ListBucket` → 403 in production.
The worker's `headObject` catch correctly handles 404/NotFound but re-throws everything else — so 403 propagated as `UnknownError` and the job failed.
`iam:simulate-principal-policy` reported "allowed" — that simulation does **not** model this S3 behavior quirk.
Fix: add `s3:ListBucket` on bucket ARNs (not `/*`) to `vtaas-worker-task-role`. IAM policy changes take effect immediately; no redeploy required.
`02-create-iam-roles.sh` updated with the `S3ListBucket` statement so future reprovisioning is correct.

- **Rule:** Any role that calls `HeadObject` on potentially non-existent keys must also have `s3:ListBucket` on the bucket ARN (no wildcard suffix).

---

## D-041: AWS Cost Optimization (May 2026)

- **Status:** Decided (implemented 2026-05-21)
- **Scope:** ECS Fargate sizing & pricing model, ECR lifecycle, CloudWatch retention, budget alerting. Live optimization only — does not change application code, CI/CD, networking, or external dependencies (Neon, S3, Vercel).

### Context

April 2026 gross AWS spend was $57.65/month, fully covered by remaining free-tier credit. Credit runway was approximately 25 days at burn rate. After credit exhaustion the project would have shifted from "free portfolio demo" to "out-of-pocket portfolio demo" at the same gross rate. The optimization target was bringing gross to ~$20/month while keeping the site continuously live.

April line items:

| Service | Cost | Note |
|---|---|---|
| ECS Fargate | $26.66 | 540 vCPU-hrs + 1,080 GB-hrs across 2 always-on tasks |
| ALB | $16.20 | 720 hrs × $0.0225 fixed cost |
| VPC Public IPv4 | $14.41 | 2,882 IP-hours |
| ECR storage | $0.38 | 3.76 GB |
| Everything else (CW, S3, SQS, KMS) | $0.00 | Inside free tier |
| **Total** | **$57.65** | |

Architectural constraints carried forward unchanged from prior decisions: always-on worker (D-037), Neon Postgres, ECS Fargate, ALB, Vercel-hosted frontend with `/api/*` rewrites. None of these were revisited.

### Discovery

Two ECS services exist (not one as the original optimization brief assumed): `vtaas-api` (HTTP backend behind the ALB, target group `vtaas-api-tg`) and `vtaas-worker` (SQS consumer for ffmpeg transcoding). Both ran on-demand Fargate without capacity providers configured at the cluster level.

Sizing before optimization:

| Service | vCPU | Memory | Per-month $ |
|---|---|---|---|
| `vtaas-worker` | 0.5 | 1 GB | $17.77 |
| `vtaas-api` | 0.25 | 0.5 GB | $8.89 |

Math reconciles exactly to billed 540 vCPU-hrs and 1,080 GB-hrs.

14-day CloudWatch utilization (336 hourly samples, 2026-05-07 → 2026-05-21):

| Service | CPU avg | CPU peak | Memory avg | Memory peak |
|---|---|---|---|---|
| `vtaas-worker` | 0.03% | 21.99% | 3.71% | 3.96% (~41 MB of 1024) |
| `vtaas-api` | 0.08% | 71.26% | 9.90% | 10.35% (~53 MB of 512) |

### Decisions

#### 1. CloudWatch log retention → 14 days

Both `/ecs/vtaas-api` and `/ecs/vtaas-worker` had no retention set (AWS default is infinite). API group had grown to ~75 MB; without a cap, it would grow unbounded against the 5 GB CloudWatch free tier. Set to 14 days — long enough for debugging a recent incident, short enough that any single hot logger doesn't push us over free tier.

#### 2. ECR lifecycle policies

ECR storage had grown from 3.76 GB (April bill) to 12.68 GB by May 21 — a **3.4× increase in six weeks**. At the observed growth rate, year-end ECR cost without intervention would have been ~$5/mo. CI/CD pushes a new image per commit; without a sweeper, old revisions accumulate indefinitely.

Applied policy to both `vtaas-api` and `vtaas-worker` repos:
- Keep last 10 tagged images
- Expire untagged images older than 7 days

The 10-tagged cap covers rollback to any of the last 10 deploys. Untagged images are CI build remnants and have no operational value after a week.

#### 3. ALB AZ count

Audited: already on 2 AZs (`us-east-1b`, `us-east-1e`). No change. The minimum for ALB high availability is 2 AZs; we were already at the floor. Going to 1 AZ would have saved nothing meaningful relative to its risk (single-AZ outage takes the site down).

#### 4. Fargate task right-sizing

**`vtaas-worker`: 0.5 vCPU / 1 GB → 0.25 vCPU / 0.5 GB** (Fargate minimum).

CPU avg 0.03% and memory peak 4% mean the worker uses <50 MB of its 1 GB allocation 99% of the time. The 22% CPU peak corresponds to occasional ffmpeg work. Dropping to half the CPU will roughly double ffmpeg wallclock per job, which is acceptable for a queue-driven workload with no SLA. Memory headroom remains ~10× peak usage even at the new size.

The worker utilization data also validates the original always-on architectural choice (D-037). At the new Spot pricing of ~$2.67/mo, scale-to-zero engineering complexity (CloudWatch alarm + step scaling on SQS depth, cold-start latency on first job, alarm tuning) is uneconomical — there's no payback window where saving $2.67/mo justifies that engineering investment. Always-on is the right call *because* the workload is so cheap once right-sized.

**`vtaas-api`: no change.** Already at the Fargate minimum (0.25 vCPU / 0.5 GB). Memory is over-provisioned (10% peak), but Fargate doesn't permit less than 0.5 GB at this CPU tier. The 71% CPU peak is a sub-minute burst on a 0.25 vCPU allocation — would not be a concern at 0.5 vCPU, but since we can't go smaller, the burst is what it is. No action.

#### 5. Fargate Spot capacity providers

Cluster previously had no capacity providers configured (`launchType: FARGATE` directly on each service). Added `FARGATE` + `FARGATE_SPOT` to the cluster, then assigned a workload-specific strategy per service:

**`vtaas-worker` → 100% `FARGATE_SPOT`** (`capacityProvider=FARGATE_SPOT,weight=1`).
Queue-driven, idempotent, SQS retries on interruption. If a Spot reclaim happens mid-job:
- AWS sends `SIGTERM` with a 2-minute warning
- In-flight SQS messages have a 300s `VisibilityTimeout` (D-011); they reappear and are picked up by the replacement task
- No user-visible impact

**`vtaas-api` → 80/20 Spot/On-Demand** (`capacityProvider=FARGATE_SPOT,weight=4 capacityProvider=FARGATE,weight=1`).
Synchronous HTTP. A 2-minute reclaim warning followed by task termination means brief request failures during the replacement deploy. Pure 100% Spot here trades meaningful availability for ~$2/mo. The 80/20 mix captures most of the savings (~$10 of the ~$12 max) while keeping On-Demand in the placement strategy.

**The desiredCount=1 statistical distribution caveat**: ECS capacity provider weights are placement-time, not runtime. With `desiredCount=1`, the 80/20 split for `vtaas-api` manifests as statistical distribution across task restart events, not as concurrent task placement. At any given moment the single API task is fully on one provider. Long-run interruption exposure averages to ~80%. For VTaaS's portfolio traffic this is acceptable; for a higher-availability service the answer would be raising `desiredCount` to 5 so the 4:1 ratio actually runs concurrently.

#### 6. Budget alert

Existing `vtaas-monthly` budget was at $15. Raised to $30 with 80% actual threshold alerting `abhinavyedla02@gmail.com`. $30 chosen to sit above the projected steady-state of ~$22/mo (Fargate + ALB + IPv4 + ECR) but well below the pre-optimization $57.65 — so any regression in either direction triggers an email before a meaningful runway impact.

### Trade-offs

- **Spot reclaim risk on API.** A reclaim during the 80% Spot exposure window means a brief outage (seconds, while ECS launches a replacement on a different capacity provider). Mitigated by the 80/20 mix rather than eliminated.
- **Worker performance under load.** At 0.25 vCPU, ffmpeg transcoding takes ~2× longer per job. Acceptable for the current portfolio job volume; would need to revisit at sustained throughput.
- **Right-sizing reversibility.** The previous task definition `vtaas-worker:1` (0.5 vCPU / 1 GB) is preserved in ECS and can be reactivated with `aws ecs update-service --task-definition vtaas-worker:1` if the smaller size proves insufficient.

### Result

Projected gross monthly cost:

| Stage | Worker | API | Fargate total | ALB | IPv4 | ECR | Total | vs April |
|---|---|---|---|---|---|---|---|---|
| April baseline | $17.77 | $8.89 | $26.66 | $16.20 | $14.41 | $0.38 | **$57.65** | — |
| After right-size + Spot | $2.67 | $3.91 | $6.58 | $16.20 | $14.41 | $0.10 | **~$37.30** | −$20.35 |

The ~$30/mo of ALB + IPv4 is the **structural floor** of running an internet-facing ALB with public-IP Fargate tasks. There is no further reduction possible without changing the architecture (e.g. API Gateway + Lambda, NAT Gateway with private subnets, scale-to-zero) — all rejected as too invasive for the savings.

Credit runway extends from ~25 days to ~75–90 days at the new gross rate.

### What we considered and rejected

- **Scale-to-zero worker.** Considered; rejected. Worker at 0.25 vCPU on Spot costs $2.67/mo. Implementation requires CloudWatch alarm on SQS queue depth, step-scaling policy, alarm tuning to avoid flapping, and 2–3 min cold start per first-job latency. Engineering effort wouldn't pay back in years.
- **API Gateway + Lambda migration.** Considered; rejected. Would eliminate Fargate cost (~$8.89/mo) and remove the ALB ($16.20/mo) and most of the IPv4 charge. But: rewriting NestJS to Lambda handlers is a multi-week effort with cold-start regressions in user-facing latency, plus loss of the WebSocket-style features available behind ALB. Not worth ~$25/mo on a portfolio project.
- **NAT Gateway to eliminate public IPs on Fargate.** Considered; rejected. A NAT Gateway costs $32/mo on its own — more than the entire $14.41 IPv4 line it would replace.
- **Single-AZ ALB.** Rejected for resilience reasons (AZ-level outage takes site down) for no meaningful cost reduction.
- **Migrating worker off Fargate to EC2 Spot.** Rejected. EC2 Spot is cheaper per vCPU-hr but introduces instance lifecycle management, AMI maintenance, and AutoScaling group configuration — operational burden that doesn't fit a portfolio project.

### Post-optimization state: frozen via hibernate-deep

After the live optimizations above were committed and pushed, the project was frozen on 2026-05-21 via `./scripts/vtaas-ops.sh hibernate-deep`. This took the cost further from the ~$37/mo live floor to **~$0.50/mo** by removing the two pieces of structural cost (ALB and IPv4) that couldn't be touched while serving traffic:

- Both ECS services scaled to `desiredCount=0` (drained, then idle)
- ALB and its HTTP:80 listener deleted
- ALB + listener config snapshotted to `~/.vtaas-ops/last-alb.json` and `~/.vtaas-ops/last-listeners.json` for clean recreation
- Static portfolio frontend on Vercel continues to serve normally; `/api/*` requests fail (no ALB to rewrite to) — accepted as the cost of freezing

Frozen-state monthly cost:

| Service | $/mo |
|---|---|
| ECR storage (post-lifecycle, ~3 GB/repo × 2) | ~$0.50 |
| Everything else (S3, CloudWatch, Route 53 — within free tier) | $0.00 |
| **Frozen total** | **~$0.50** |

ECS services, capacity providers, task definitions, target group, security groups, IAM roles, ECR images, and S3 buckets are all preserved. Resume rebuilds only the ALB and re-scales the services.

#### Resume procedure

Documented in `RESUME.md` at repo root. Three steps:

1. `./scripts/vtaas-ops.sh resume-deep` — recreates ALB + HTTP listener, scales both services back to 1
2. Update Vercel `vercel.json` `/api/*` rewrite destination to the new ALB DNS (the script prints it on completion)
3. Trigger a Vercel redeploy

The new ALB DNS will differ from `vtaas-alb-622316371.us-east-1.elb.amazonaws.com` because AWS regenerates the DNS at ALB creation time. The saved JSON in `~/.vtaas-ops/last-alb.json` is a reference for the prior state (subnets, SGs, listener config — all of which the script re-uses from CONFIG, not from the JSON).

### References

- Optimization brief: in conversation history (not in repo)
- Baseline measurements: `docs/private/optimization-baseline-20260521.md` (gitignored)
- Tooling: `scripts/vtaas-ops.sh`, `scripts/ecr-lifecycle.json`
- Resume procedure: `RESUME.md` (repo root)
- Prior decisions referenced: D-011 (SQS configuration), D-035 (AWS resources), D-037 (worker always-on)