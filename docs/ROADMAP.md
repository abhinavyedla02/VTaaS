
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
  2. Use `String[]` for `output_keys` (simpler than JSONB for Phase 0)
  3. Run `npx prisma migrate dev --name init_jobs`
- **Commit:** `feat: define job schema and migration`
- **Push:** `feat/issue-2.2-schema`
- **AC:** `jobs` table exists with columns: `id`, `user_id`, `request_id`, `status`, `input_key`, `output_keys` (text array), `error`, `created_at`, `updated_at`
- **Proof:** `docker compose exec db psql -U vtaas -c "\d jobs"` shows table schema
- **Rollback:** run down migration or drop table

#### 2.3 Unique `(user_id, input_key)` constraint — ⬜ Planned
- **Git Branch:** `feat/issue-2.3-unique-constraint`
- **Work:**
  1. Add named constraint `@@unique([userId, inputKey], name: "user_input_unique")`
  2. Run `npx prisma migrate dev --name unique_user_input`
- **Commit:** `feat: add named unique constraint to jobs`
- **Push:** `feat/issue-2.3-unique-constraint`
- **AC:** unique constraint `user_input_unique` exists; duplicate insert fails
- **Proof:** attempt duplicate insert via psql → error message shows constraint name
- **Rollback:** drop constraint via migration

#### 2.4 Type-safe status + transition helper — ⬜ Planned
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

#### 2.5 Dev user resolver — ⬜ Planned
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
- **Key decision:** presigned PUT in Phase 0; content-type enforced; size validated at issuance and verified via HEAD before job creation/enqueue.

Sub-issues (planned):
- 3.1 Buckets + SDK client config (LocalStack)
- 3.1.1 Bucket CORS for browser PUT (dev)
- 3.2 Upload route stub (501)
- 3.3 Presign PUT URL returns `{ url, inputKey, headers }`
- 3.4 Validation & limits (allowed mime types + max size)
- 3.5 Integration tests: presign -> PUT -> HEAD
- 3.6 Optional web upload MVP (after API endpoints exist)

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
