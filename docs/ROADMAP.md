# VTaaS Roadmap

## Principles
- This roadmap is **issue-driven** and intentionally boring (public repo).
- Each item has **AC / Proof / Rollback**.
- No dates. No personal notes. Just engineering.

---

## North Star

A visitor lands on the portfolio page, sees a sleek upload form, drops a short video, watches it transcode in real time, and downloads the 720p output — all powered by a real AWS pipeline they can see in a live system diagram on the same page. No login wall. No payment screen.

---

# Phase 1 — The Core Engine (Local Pipeline)

*Build the fully functional transcode pipeline locally using Docker Compose + LocalStack. No cloud deployment until this is complete.*

---

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

### ISSUE-2: Job Model + Migrations
- **Goal:** DB-backed job lifecycle with idempotency.
- **Key decision:** `user_id` is NOT NULL in Phase 0 (dev stub).

#### 2.1 ORM + migration tooling — ✅ Done
- **AC:** ORM (Prisma) installed and configured; migration CLI works; can connect to Postgres in Docker Compose
- **Proof:** `npm run migrate:status` shows connection success; empty migration list
- **Rollback:** remove ORM package + config files

#### 2.2 Define Job schema + migrations — ✅ Done
- **AC:** `jobs` table exists with columns: `id`, `user_id`, `request_id`, `status`, `input_key`, `output_keys`, `error`, `created_at`, `updated_at`
- **Proof:** `docker compose exec db psql -U vtaas -c "\d jobs"` shows table schema
- **Rollback:** run down migration or drop table

#### 2.3 Unique `(user_id, input_key)` constraint — ✅ Done
- **AC:** unique constraint `user_input_unique` exists; duplicate insert fails
- **Proof:** attempt duplicate insert via psql → error message shows constraint name
- **Rollback:** drop constraint via migration

#### 2.3.1 DomainException base class — ✅ Done
- **AC:** `DomainException` can be thrown with a code and message; inherits HTTP semantics
- **Proof:** unit test shows `throw new DomainException('INVALID_TRANSITION', 'msg')` works
- **Rollback:** revert PR

#### 2.4 Type-safe status + transition helper — ✅ Done
- **AC:** Helper prevents invalid transitions with specific exception logic
- **Proof:** unit test verifies `PROCESSING -> PENDING` throws exception
- **Rollback:** revert PR

#### 2.5 Dev user resolver — ✅ Done
- **AC:** Decorator correctly resolves ID and handles fallback
- **Proof:** curl without header -> gets default; curl with header -> gets header
- **Rollback:** remove resolver; job creation fails until auth exists

---

### ISSUE-3: Presigned Upload (LocalStack S3)
- **Goal:** Browser uploads directly to object storage using presigned PUT.

#### 3.1 S3 Infrastructure — ✅ Complete
#### 3.2.1 Upload Validation Logic — ✅ Complete
#### 3.2.2 Upload Service Integration — ✅ Complete
#### 3.2.3 Upload Controller Wiring — ✅ Complete
#### 3.3.1 HEAD Object Helper — ✅ Complete
#### 3.3.2 Upload Integration Tests — ✅ Complete
#### 3.4 Web Upload MVP — ✅ Complete

---

### ISSUE-4: Create Job → Enqueue (SQS)
- **Goal:** Create `PENDING` job row and enqueue message to SQS.

#### 4.1 SQS Infrastructure — ✅ Done
#### 4.2 Queue client wrapper `enqueueTranscode(...)` — ✅ Done
#### 4.3 `POST /api/jobs` creates DB row only — ✅ Done
#### 4.4 Enqueue message after DB write (`ENQUEUE_ENABLED` flag) — ✅ Done
#### 4.5 Idempotency: duplicate create returns existing job — ✅ Done
#### 4.6 `GET /api/jobs/:id` (polling endpoint) — ✅ Done
#### 4.7 Contract tests for job endpoints — ✅ Done

---

### ISSUE-5: Worker v0 (ffmpeg 720p)
- **Goal:** Worker consumes SQS, transcodes via ffmpeg, uploads output to S3, updates DB status.

#### 5.0 Monorepo & Worker Scaffold — ✅ Done
#### 5.1 SQS Consumer & Output Dedupe — ✅ Done
#### 5.2 Transcode Execution & State Transitions — ✅ Done

#### 5.3 End-to-End Verification — ✅ Done
- **Git Branch:** `feat/issue-5.3-e2e-verify`
- **Prerequisite gate:** Verify `@vtaas/db` `main` field resolves correctly in Docker production build before any other step.
  - **Issue:** `packages/db/package.json` has `"main": "src/index.ts"` — a TypeScript path. The Dockerfiles do not compile `@vtaas/db` separately (`npm run generate` only runs `prisma generate`, not `tsc`). At runtime, Node resolves `require('@vtaas/db')` → `src/index.ts` → crash (Node cannot execute `.ts` files).
  - **Fix:** Add `npm run build --workspace=@vtaas/db` (which runs `tsc`) to both Dockerfiles after `npm run generate`, and update `"main"` to `"dist/index.js"` in `packages/db/package.json`.
- **Work:**
  1. Fix the `@vtaas/db` Docker build issue (prerequisite gate above)
  2. Generate a minimal test video: `ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -c:v libx264 /tmp/vtaas-test-video.mp4`
  3. Extend `scripts/test-jobs-flow.sh` with new steps:
     - **Step 9:** Poll `GET /api/jobs/{id}` every 2s, 60s timeout, until `SUCCEEDED` or `FAILED`
     - **Step 10:** Assert status is `SUCCEEDED`
     - **Step 11:** Assert `outputKeys` contains `outputs/{jobId}/720p.mp4`
     - **Step 12:** Assert S3 output exists via `curl http://localhost:4566/vtaas-outputs/outputs/{jobId}/720p.mp4`
     - **Step 13:** (renumbered from above)
- **AC:** `./scripts/test-jobs-flow.sh` completes all 13 steps; final output shows "ALL CHECKS PASSED"
- **Proof:** `./scripts/test-jobs-flow.sh` — ALL CHECKS PASSED (Steps 1–13)
- **Rollback:** Revert new steps; existing Steps 1–8 remain functional

---

# Phase 2 — Hardening

*CI pipeline, abuse protection, and cleanup. This phase gates cloud deployment.*

---

### ISSUE-6: CI v1 (GitHub Actions) — ✅ Done
- **Work:**
  1. GitHub Actions workflow: lint, typecheck, all tests across all workspaces
  2. Build API and Worker Docker images (validates Dockerfile correctness)
  3. Include contract tests for `GET /api/jobs/:id` response shape
- **AC:** PRs to `main` are gated by green CI; Docker images build successfully in CI
- **Proof:** https://github.com/abhinavyedla02/VTaaS/actions/runs/23254704523 — both jobs green (Test + Typecheck: 52s, Docker Build: 3m27s)
- **Rollback:** Disable workflow via `.github/workflows/` rename

### ISSUE-7: Abuse Guard + Cleanup Cron — ✅ Done
- **Goal:** Protect the live demo from bots and runaway AWS costs without a login wall.
- **Work:**
  1. **Submitter name form:** Add `submitter_name` (text, nullable) and `note` (text, nullable) columns to `jobs` table via migration. Input collected in frontend before upload (no auth required).
  2. **IP rate limiting:** `@nestjs/throttler` on `POST /api/uploads` and `POST /api/jobs` (3 uploads/hour per IP)
  3. **File size cap:** Enforce `MAX_UPLOAD_SIZE_BYTES=20971520` (20MB) in production env
  4. **Max video duration:** `ffprobe` check in worker before transcoding; reject videos > 60s with `FAILED` / error `VIDEO_TOO_LONG`
  5. **Cleanup cron:** `@nestjs/schedule` — purge jobs + S3 objects older than 24hrs (protects Neon row limit and S3 accumulation)
  6. **AWS billing alert:** $4 threshold alert via AWS Budgets (infra config, documented in `DECISIONS.md`, not code)
- **AC:** Repeated uploads from same IP are rate-limited after 3/hr; videos > 60s fail with correct error code; cron runs hourly and cleans old records
- **Proof:** 128 tests passing (20 db / 75 api / 33 worker); tsc --noEmit clean in all workspaces
- **Rollback:** Remove throttler guards; remove `@nestjs/schedule`; remove duration check from worker

---

# Phase 3 — Portfolio Frontend

*The face of the portfolio. Ships the UI, job status experience, and the pipeline diagram together.*

---

### ISSUE-8: Portfolio UI — ✅ Done
- **Work:**
  1. Replaced Issue 1.5 placeholder with full single-page portfolio layout
  2. Six sections: Hero, "Why This Exists" (motivation hook), DemoWidget (step-by-step upload with submitter name field), SystemDiagram (two-row SVG pipeline), AboutStack (7-item tech grid), WhatsNext (3 future-work callouts)
  3. Design system: CSS variables, dark-mode-only, Inter + JetBrains Mono via CDN, no CSS framework
  4. Client-side file validation (type + 20MB size) alongside existing server-side checks
  5. Proper drag-and-drop with visual hover feedback on the drop zone
- **AC:** Single-page app loads, hero is polished, upload flow includes name field, all sections rendered
- **Proof:** `tsc --noEmit` clean; `npm run build` clean (43 modules); visual verification at 1440px — all diagram labels readable, no horizontal scroll
- **Commit:** `9cfe031` — `feat(web): issue-8 portfolio UI rebuild` (17 files, +1491 −245)
- **Rollback:** Revert to basic upload MVP (`git revert 9cfe031`)

### ISSUE-9: Job Status Polling + Video Player — ⬜ Planned
- **Work:**
  1. Real-time polling via `GET /api/jobs/:id` (2s interval, stop on terminal state)
  2. Progress states shown: uploading → pending → processing → succeeded/failed
  3. On `SUCCEEDED`: render output video via presigned GET URL from the API
- **AC:** Full flow visible in UI; video plays inline on success without a separate download step
- **Rollback:** Remove polling loop; show static status badge only

### ISSUE-10: Interactive Pipeline Diagram — ⬜ Planned
- **Goal:** The highest-impression element for any engineer visiting the site. Shows the real distributed system at a glance.
- **Work:**
  1. Build an interactive Mermaid or SVG-based flowchart: Browser → API → S3 → SQS → Worker → S3 → Browser
  2. Annotate with real technical labels (queue name, bucket names, ECS task arrows, Neon DB)
  3. Embed as a dedicated section in the portfolio page (below the demo widget)
  4. Optional: live stats ticker (total jobs processed, current queue depth) via a new `GET /api/stats` endpoint
- **AC:** Diagram renders correctly on desktop and mobile; labels match actual deployed resource names
- **Rollback:** Replace with a static image

---

# Phase 4 — AWS Deployment

*One environment. No staging vs. prod split. ECS Fargate for API and Worker. Vercel for frontend.*

---

### ISSUE-11: AWS Infrastructure Setup — ⬜ Planned
- **Deployment stack:** ECS Fargate (API + Worker), ECR (images), S3, SQS, Neon (Postgres), ALB (API only)
- **Work:**
  1. Provision S3 buckets (`vtaas-inputs`, `vtaas-outputs`) in real AWS
  2. Provision SQS queues (`transcode-jobs`, `transcode-jobs-dlq`) with correct `VisibilityTimeout: 300`
  3. Provision Neon database; run `prisma migrate deploy` against it
  4. Create IAM roles for API task and Worker task (least-privilege: S3 + SQS access only)
  5. Create ECR repositories for `vtaas-api` and `vtaas-worker`
  6. Document all ARNs, queue URLs, bucket names, and IAM role ARNs in `DECISIONS.md`
  7. Set AWS billing alert ($4 threshold) in AWS Budgets
- **AC:** All AWS resources exist; ECR repos are accessible; Neon migration succeeds; `DECISIONS.md` is complete
- **Proof:** `aws s3 ls`, `aws sqs list-queues`, ECR repo list, Neon migration output, billing alert screenshot
- **Rollback:** `terraform destroy` or manual resource deletion

### ISSUE-12: API Deployment (ECS Fargate + ALB) — ⬜ Planned
- **Work:**
  1. Push API Docker image to ECR via GitHub Actions (add deploy job to CI workflow)
  2. ECS task definition: API container, env vars (Neon connection string, S3/SQS config, `ENQUEUE_ENABLED=true`)
  3. ECS Fargate service + ALB with HTTPS listener
  4. Point custom domain at ALB (Route 53 A record or CNAME at registrar)
  5. Lock CORS origins to Vercel production domain
- **AC:** `curl https://api.yourdomain.com/api/health` → `{"status":"ok"}`; CORS allows Vercel origin only
- **Proof:** curl output; browser network tab showing no CORS errors from Vercel domain
- **Rollback:** Scale ECS service to 0 tasks

### ISSUE-13: Worker Deployment (ECS Fargate) — ⬜ Planned
- **Work:**
  1. Push Worker Docker image to ECR via GitHub Actions
  2. ECS task definition: Worker container, env vars (Neon connection string, S3/SQS config)
  3. Long-running ECS Fargate task (no ALB — SQS polling is outbound, no inbound traffic)
  4. IAM task role with access to SQS receive/delete, S3 get/put, Neon (via connection string)
- **AC:** Worker starts and logs "Polling SQS..."; a job created via the API is picked up and transcoded end-to-end in cloud
- **Proof:** ECS task logs showing full `PENDING → PROCESSING → SUCCEEDED` flow; S3 output object visible in AWS console
- **Rollback:** Stop ECS task; set `ENQUEUE_ENABLED=false` on API to halt job dispatch

### ISSUE-14: Frontend Deployment (Vercel) — ⬜ Planned
- **Work:**
  1. Connect `web/` to Vercel project
  2. Set `VITE_API_URL` env var to the API's custom domain
  3. Confirm end-to-end flow works from production Vercel URL against AWS backend
- **AC:** Full upload → transcode → video playback flow works from the live Vercel URL
- **Proof:** Screen recording or screenshot of the full demo flow on the production URL
- **Rollback:** Revert Vercel env vars to local API URL

---

## What's Next (Not in Scope — Portfolio Callout)

These items are intentionally out of scope for this project. They exist as a technical "what's next" section on the portfolio site and as honest talking points for engineering interviews:

- **AI Video Upscaling Tier:** A Python worker running Real-ESRGAN on GPU-enabled ECS Fargate, consuming a separate `transcode-jobs-ai` SQS queue. Standard jobs would stay on the Node.js worker; AI jobs would route to the Python worker via `jobType` field in the SQS payload.
- **User Authentication:** Replace the `DevUserInterceptor` and submitter name form with a real auth provider (Clerk or Auth0). Unlock per-user job history.
- **Distributed Tracing (OTEL):** Instrument API → SQS → Worker with OpenTelemetry for end-to-end trace visibility.