
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