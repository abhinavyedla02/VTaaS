
---

## `docs/ROADMAP.md`

```markdown
# VTaaS Roadmap (Public, Sanitized)

## Principles
- This roadmap is **issue-driven** and intentionally boring (public repo).
- Each item has **AC / Proof / Rollback**.
- No dates. No personal notes. Just engineering.

---

## Phase 0A — Foundation (Local dev shape + observability)

### ISSUE-1: Repo Init + Compose
#### 1.1 Bootstrap repo scaffold — ✅ Done
- **AC:** monorepo folders exist (`api/`, `worker/`, `web/`, `infra/`); Node pinned; README quickstart
- **Proof:** tree/README renders
- **Rollback:** revert PR

#### 1.2 Compose: db + localstack only — ✅ Done (with follow-up required)
- **AC:** `docker compose up` starts healthy Postgres and LocalStack
- **Proof:** `docker ps` + health outputs
- **Rollback:** remove services from compose

#### 1.2.1 LocalStack healthcheck + depends_on alignment — ✅ Done
- **AC:** LocalStack becomes `healthy` and `depends_on: service_healthy` is valid. Healthcheck must not assume curl exists in the image.
- **Proof:** compose ps shows healthy; LocalStack health endpoint responds
- **Rollback:** revert healthcheck change


#### 1.3 Minimal API with healthcheck — ✅ Done
- **AC:** `curl localhost:3000/api/health` -> `{"status":"ok"}`
- **Proof:** curl + container logs
- **Rollback:** remove api service/Dockerfile

#### 1.4 JSON request logging — ✅ Done
- **AC:** hitting `/api/health` prints one structured JSON log line
- **Proof:** paste one log line in PR
- **Rollback:** disable middleware behind env flag

#### 1.5 Web placeholder (optional) — ✅ Done
- **AC:** `http://localhost:5173` loads and can call `GET /api/health` from the browser
- **Proof:** screenshot/network success
- **Rollback:** remove web service

---

## Phase 0B — Core Pipeline (Local end-to-end demo)

### ISSUE-2: Job Model + Migrations
- **Goal:** DB-backed job lifecycle with idempotency.
- **Key decision:** `user_id` is NOT NULL in Phase 0 (dev stub).

#### 2.1 ORM + migration tooling — ✅ Done
- **AC:** ORM (e.g., Prisma, TypeORM, or Drizzle) installed and configured; migration CLI works; can connect to Postgres in Docker Compose
- **Proof:** `npm run migrate:status` (or equivalent) shows connection success; empty migration list
- **Rollback:** remove ORM package + config files

#### 2.2 Define Job schema + migrations — ✅ Done
- **Git Branch:** `feat/issue-2.2-schema`
- **Work:**
  1. Add `Job` model to `schema.prisma` with `requestId` (String?)
  2. Use `String[]` for `output_keys` (simpler than JSONB for Phase 0) - EDIT: will be keeping as JSON. we might need the metadata for other purposes.
  3. Run `npx prisma migrate dev --name init_jobs`
- **Commit:** `feat: define job schema and migration`
- **Push:** `feat/issue-2.2-schema`
- **AC:** `jobs` table exists with columns: `id`, `user_id`, `request_id`, `status`, `input_key`, `output_keys` (text array), `error`, `created_at`, `updated_at`
- **Proof:** `docker compose exec db psql -U vtaas -c "\d jobs"` shows table schema
- **Rollback:** run down migration or drop table

#### 2.3 Unique `(user_id, input_key)` constraint — ✅ Done
- **Git Branch:** `feat/issue-2.3-unique-constraint`
- **Work:**
  1. Add named constraint `@@unique([userId, inputKey], name: "user_input_unique")`
  2. Run `npx prisma migrate dev --name unique_user_input`
- **Commit:** `feat: add named unique constraint to jobs`
- **Push:** `feat/issue-2.3-unique-constraint`
- **AC:** unique constraint `user_input_unique` exists; duplicate insert fails
- **Proof:** attempt duplicate insert via psql → error message shows constraint name
- **Rollback:** drop constraint via migration

#### 2.3.1 DomainException base class — ✅ Done
- **Git Branch:** `feat/issue-2.3.1-domain-exception`
- **Work:**
  1. Create `api/src/common/exceptions/domain.exception.ts` extending `HttpException`
  2. Add typed error code support (`code: string` field for downstream consumers)
  3. Export from `api/src/common/exceptions/index.ts`
- **Commit:** `feat: add DomainException base class`
- **Push:** `feat/issue-2.3.1-domain-exception`
- **AC:** `DomainException` can be thrown with a code and message; inherits HTTP semantics
- **Proof:** unit test shows `throw new DomainException('INVALID_TRANSITION', 'msg')` works
- **Rollback:** revert PR

#### 2.4 Type-safe status + transition helper — ✅ Done
- **Git Branch:** `feat/issue-2.4-status-helper`
- **Work:**
  1. Implement `transitionStatus` that acts as the **only** setter
  2. Throw `DomainException` (or NestJS `BadRequestException`) on invalid transition
  3. Valid: `PENDING->PROCESSING`, `PROCESSING->SUCCEEDED|FAILED`
- **Commit:** `feat: add strict status transition logic`
- **Push:** `feat/issue-2.4-status-helper`
- **AC:** Helper prevents invalid transitions with specific exception logic
- **Proof:** unit test verifies `PROCESSING -> PENDING` throws exception
- **Rollback:** revert PR

#### 2.5 Dev user resolver — ✅ Done
- **Git Branch:** `feat/issue-2.5-dev-user`
- **Work:**
  1. Implement `UserInterceptor`: `x-user-id` -> `DEV_USER_ID` -> "LocalDevUser" (log warning)
  2. Implement custom `@User()` decorator
  3. Controller uses `@User() userId: string`
- **Commit:** `feat: add user interceptor and decorator`
- **Push:** `feat/issue-2.5-dev-user`
- **AC:** Decorator correctly resolves ID and handles fallback
- **Proof:** curl without header -> gets default; curl with header -> gets header
- **Rollback:** remove resolver; job creation fails until auth exists

---

### ISSUE-3: Presigned Upload (LocalStack S3)
- **Goal:** Browser uploads directly to object storage using presigned PUT.
- **Key decisions:**
  - Presigned PUT (not POST) for simplicity
  - Strict mime type allowlist (`video/mp4`, `video/quicktime`, `video/webm`)
  - Size validated at URL issuance + verified via HEAD before job creation
  - Bucket created via `onModuleInit` (idempotent, TypeScript-visible)

#### 3.1 S3 Infrastructure — ✅ Complete
- **Git Branch:** `feat/issue-3.1-s3-infra`
- **Work:**
  1. Create `S3Module` with configured client (path-style, LocalStack endpoint)
  2. `onModuleInit`: create `vtaas-inputs` bucket if missing (headBucket → createBucket)
  3. Apply CORS rules (allow PUT/GET/HEAD from `*` for dev)
  4. Export `S3Service` for use by upload module
- **Commit:** `feat: add S3 module with bucket init and CORS`
- **Push:** `feat/issue-3.1-s3-infra`
- **AC:** App starts, logs "Bucket initialized", `awslocal s3 ls` shows `vtaas-inputs`
- **Proof:** Startup logs + `awslocal s3 ls` output
- **Rollback:** Remove S3Module; app starts without S3 connectivity

#### 3.2 Presigned Upload Endpoint

##### 3.2.1 Upload Validation Logic — ✅ Complete
- **Git Branch:** `feat/issue-3.2.1-upload-validation`
- **Work:**
  1. Create `api/src/uploads/upload.rules.ts` with pure validation functions
  2. Mime type allowlist map: `video/mp4` → `mp4`, `video/quicktime` → `mov`, `video/webm` → `webm`
  3. `validateMimeType(mimeType)` → returns extension or throws `DomainException` (`UNSUPPORTED_MIME_TYPE`)
  4. `validateSize(sizeBytes)` → throws `DomainException` (`FILE_TOO_LARGE`) if > `MAX_UPLOAD_SIZE_BYTES`
  5. Unit tests for all validation paths
- **Commit:** `feat: add upload validation logic`
- **AC:** Unit tests pass; validation functions correctly accept/reject inputs
- **Proof:** Test output
- **Rollback:** Remove `upload.rules.ts`

##### 3.2.2 Upload Service Integration — ✅ Complete
- **Git Branch:** `feat/issue-3.2.2-upload-service`
- **Work:**
  1. Create `UploadsModule` and `UploadsService`
  2. Inject `S3Service` for presigned URL generation
  3. `generateUploadUrl(mimeType, sizeBytes)` method:
     - Validates input using `upload.rules.ts`
     - Generates UUID key: `inputs/{uuid}.{ext}`
     - Calls S3 presign with expiry from `UPLOAD_EXPIRY_SECONDS`
     - Returns `{ url, inputKey, expiresIn }`
  4. Unit tests with mocked S3Service
- **Commit:** `feat: add uploads service with presign logic`
- **AC:** Service generates valid presigned URLs
- **Proof:** Unit test output
- **Rollback:** Remove `UploadsService`

##### 3.2.3 Upload Controller Wiring — ✅ Complete
- **Git Branch:** `feat/issue-3.2.3-upload-controller`
- **Work:**
  1. Create `UploadsController` with `POST /api/uploads`
  2. DTO: `CreateUploadDto { mimeType: string, sizeBytes: number }`
  3. Controller calls `UploadsService.generateUploadUrl()`
  4. Register `UploadsModule` in `AppModule`
- **Commit:** `feat: add uploads controller and wire to app`
- **AC:** `curl -X POST /api/uploads -d '{"mimeType":"video/mp4","sizeBytes":1000}'` returns presigned URL
- **Proof:** curl output + `awslocal s3 ls` after PUT
- **Rollback:** Remove controller; service remains testable

---

#### 3.3 HEAD Check + Integration Tests

##### 3.3.1 HEAD Object Helper — ✅ Complete
- **Git Branch:** `feat/issue-3.3.1-head-object`
- **Work:**
  1. Add `headObject(key)` method to `S3Service`
  2. Returns `{ size: number, contentType: string }` or throws if object missing
  3. Unit test with mocked S3 client
- **Commit:** `feat: add headObject helper to S3Service`
- **AC:** `headObject` correctly returns metadata or throws
- **Proof:** Unit test output
- **Rollback:** Remove method from S3Service

##### 3.3.2 Upload Integration Tests — ✅ Complete
- **Git Branch:** `feat/issue-3.3.2-upload-integration`
- **Work:**
  1. Create integration test script: presign → PUT (curl) → HEAD → verify size
  2. Test full flow with LocalStack running
  3. Document test commands in DEVELOPMENT.md
- **Commit:** `feat: add upload integration tests`
- **AC:** Integration test passes end-to-end
- **Proof:** Test output showing full flow
- **Rollback:** Remove test script

#### 3.4 Web Upload MVP (Optional) — ✅ Complete
- **Git Branch:** `feat/issue-3.4-web-upload`
- **Work:**
  1. Simple upload form in React frontend
  2. Calls `POST /api/uploads`, then PUTs file to returned URL
  3. Displays success/error
- **AC:** Browser can upload file to LocalStack via presigned URL
- **Proof:** Screenshot or screen recording of successful upload
- **Rollback:** Remove upload component

---

### ISSUE-4: Create Job → Enqueue (SQS)
- **Goal:** Create `PENDING` job row and enqueue message to SQS.
- **Contract:** SQS v0 message includes `profiles`.

Sub-issues (planned):
- 4.1 Local SQS queue + DLQ creation
- 4.2 Queue client wrapper `enqueueTranscode(...)`
- 4.3 `POST /api/jobs` creates DB row only
- 4.4 Enqueue message after DB write (`ENQUEUE_ENABLED` flag)
- 4.5 Idempotency: duplicate create returns existing job and does not enqueue again
- 4.6 `GET /api/jobs/:id` (required for Phase 0 demo polling)
- 4.7 Contract tests for job endpoints

---

### ISSUE-5: Worker v0 (ffmpeg 720p)
- **Goal:** Worker consumes SQS, transcodes, uploads output, updates DB.
- **Key decision:** deterministic output keys + output dedupe for retry safety.

Sub-issues (planned):
- 5.1 Deterministic output key scheme + output dedupe (required for failure drills)
- 5.2 Worker state transitions (PROCESSING -> SUCCEEDED/FAILED)
- 5.3 End-to-end test: upload -> job -> output exists -> status SUCCEEDED

---

## Phase 0C — Reliability & Failure Proof

### ISSUE-6: Failure Drill A — Crash Mid-Transcode
- **AC:** simulate worker crash mid-ffmpeg; message retries; no duplicate outputs; final status correct
- **Proof:** logs + artifact checks
- **Rollback:** disable drill harness

---

## Phase 0D — Automation

### ISSUE-7: CI v1
- **AC:** GitHub Actions runs lint/typecheck/tests; builds API & Worker images
- **Rollback:** disable workflow via flag

---

## Phase 1 — Observability + Guardrails (after local pipeline works)
- ISSUE-8: Tracing v1 (OTEL)
- ISSUE-9: Metrics v1 (`/metrics`)
- ISSUE-10: Contract tests for `/api/jobs/:id`
- ISSUE-11: Failure Drill B — Visibility timeout + heartbeat/extend
- ISSUE-12: Error taxonomy (typed error codes)

---

## Phase 2 — Staging on AWS (Mid phase, planned)
This phase migrates the local pipeline to a minimal AWS staging footprint.
(Exact IaC tool is TBD: Terraform or CDK.)

Planned issue set (high level):
- Staging infra scaffold (VPC, ECS/ECR, S3, SQS, RDS, logs)
- Deploy API to ECS (ALB, healthcheck, secrets)
- Deploy Worker to ECS (task role, queue consume)
- CI/CD via GitHub OIDC -> ECR -> ECS deploy
- CloudFront for output playback

---

## Phase 3 — Production hardening (Final phase, planned)
Planned areas:
- Quotas/rate limits
- DLQ reprocess tooling + admin controls
- Signed playback + private content options
- Billing + idempotent webhooks
- HLS packaging + multi-profile ladder
- Cost controls (lifecycle policies, budgets/alarms)
- Deployment safety (blue/green/canary, rollback automation)

---

### ISSUE-6: Public Portfolio Readiness
*Make the application safe, cost-effective, and resilient for the open internet.*

- **Goal:** Prepare VTaaS for public deployment as an interactive portfolio piece without risking massive infrastructure bills, abuse, or infinite storage growth.

#### 6.1 Strict Resource Limits — ⬜ Planned
- **Work:** 
  1. Configure `MAX_UPLOAD_SIZE_BYTES` to a strict maximum (e.g., 20MB).
  2. Implement video duration extraction (using `ffprobe` in the worker or a fast header parser in the API) to reject files longer than 30 or 60 seconds.
  3. Hardcode maximum allowed resolutions (e.g., 720p max) to cap transcoding compute time.

#### 6.2 API Rate Limiting — ⬜ Planned
- **Work:**
  1. Install and configure `@nestjs/throttler`.
  2. Apply strict IP-based rate limits to `POST /api/uploads` (e.g., 5 uploads per hour per IP).
  3. Apply limits to `POST /api/jobs` to prevent SQS queue spamming and compute exhaustion.

#### 6.3 Ephemeral Data Cleanup (Garbage Collection) — ⬜ Planned
- **Work:**
  1. Implement a scheduled task/cron job (using `@nestjs/schedule` or an AWS EventBridge rule).
  2. The cron job runs hourly to permanently delete inputs and outputs from S3 that are older than 2 hours.
  3. The cron job purges job records from the PostgreSQL database that are older than 2 hours to keep the free-tier database tiny.

#### 6.4 Security Headers & CORS Lockdown — ⬜ Planned
- **Work:**
  1. Configure `@nestjs/helmet` for API security headers.
  2. Lock down CORS origins on both the NestJS API and the S3 bucket configuration to only allow requests from the production frontend domain.

#### 6.5 Interactive "Try Me" Demo File — ⬜ Planned
- **Work:**
  1. Create a prominent "Try Me" button on the React frontend.
  2. Clicking the button bypasses the local file picker and instead uses a pre-packaged, short (5-second), highly optimized `.mp4` file bundled with the frontend code.
  3. This ensures visitors can test the pipeline instantly without needing to find and upload their own compliant video file.
