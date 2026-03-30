# Development (Local)

## Prerequisites
- Docker (Docker Desktop or equivalent)
- Node.js 20 (this repo is pinned to Node 20)
- curl (for quick endpoint checks)
- jq (for JSON parsing in integration tests: `brew install jq`)
- awslocal CLI (for LocalStack debugging: `pip install awscli-local`)

---

## First-time setup note

After cloning, build the shared `@vtaas/db` package before TypeScript can resolve its types locally:

```bash
npm run build --workspace=@vtaas/db
```

This generates `packages/db/dist/`. Docker handles this automatically during `docker compose build` — this step is only needed for local `tsc`/IDE type resolution.

---

## First run after clone

The database starts empty. Before running the integration test, apply migrations:

```bash
docker compose up -d
docker compose exec api sh -c "cd /app && npx prisma migrate deploy \
  --schema=packages/db/prisma/schema.prisma"
```

This only needs to be done once per fresh Docker volume.
If you run `docker compose down -v`, you'll need to run it again.

> The unit tests (run via `npm test --workspaces --if-present`) do **not** need a real DB — they mock everything. The migration step is only required before running `./scripts/test-jobs-flow.sh` (the integration test).

### Sample video setup

The "Try with Sample Video" button requires a video file at `infra/sample.mp4`. This file is **gitignored** (large binary). To set it up:

```bash
# Use any short MP4 video, or generate a test one:
ffmpeg -f lavfi -i testsrc=duration=5:size=320x240:rate=24 -c:v libx264 infra/sample.mp4
```

On `docker compose up`, the LocalStack init script (`infra/localstack-init/seed-sample.sh`) automatically creates the `vtaas-samples` bucket and uploads this file.

---

## Quickstart (current state)

### Start services
```bash
docker compose up
```

### Verify services are running
```bash
# Check API health endpoint
curl http://localhost:3000/api/health
# Expected output: {"status":"ok"}

# Check web service
curl http://localhost:5173
# Expected output: Returns HTML page

# Check web health check proxy
curl http://localhost:5173/api/health
# Expected output: {"status":"ok"}

# Check LocalStack health (if healthcheck is implemented)
curl http://localhost:4566/_localstack/health

# View service status
docker compose ps

# View API logs
docker logs -f vtaas_api

# View worker logs
# Worker auto-starts SQS polling on boot, logs "Worker started" then "Polling SQS..."
docker logs -f vtaas_worker

# View web logs
docker logs -f vtaas_web

# View all service logs
docker compose logs -f
```

### Common commands
```bash
# Rebuild API after code changes
docker compose build api
docker compose up -d api

# Rebuild web after code changes
docker compose build web
docker compose up -d web

# Rebuild worker after code changes
docker compose build worker
docker compose up -d worker

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

---

## Frontend Development

The `web/` app can be run standalone (outside Docker Compose) for faster iteration:

```bash
cd web
npm run dev       # starts Vite dev server on port 5173
```

**Port:** `http://localhost:5173`  
**API proxy:** Vite proxies `/api` requests to `http://localhost:3000` (configured in `vite.config.ts`)

> **Note:** The API must be running separately for the upload flow to work. Either start it via `docker compose up api db localstack` or run it locally.

### Typecheck and build (run from `web/`, not root)

```bash
cd web
npx tsc --noEmit    # typecheck only (no output)
npm run build       # full production build (tsc + vite build)
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DEV_USER_ID` | Override default user ID for dev | (none, falls back to `LocalDevUser`) |
| `REQUEST_LOGGING_ENABLED` | Enable/disable JSON request logs | `true` |
| `MAX_UPLOAD_SIZE_BYTES` | Max file size for uploads | `524288000` (500MB) |
| `UPLOAD_EXPIRY_SECONDS` | Presigned URL expiry time | `900` (15min) |
| `MAX_VIDEO_DURATION_SECONDS` | Maximum allowed video length | `60` |
| `AWS_ENDPOINT_URL` | LocalStack endpoint | `http://localstack:4566` (Docker) |
| `AWS_REGION` | AWS region for S3/SQS client | `us-east-1` |
| `S3_INPUT_BUCKET` | S3 bucket for uploaded input files | `vtaas-inputs` (local), `vtaas-inputs-<account>` (prod) |
| `S3_OUTPUT_BUCKET` | S3 bucket for transcoded output files | `vtaas-outputs` (local), `vtaas-outputs-<account>` (prod) |
| `SQS_QUEUE_NAME` | Main transcode queue | `transcode-jobs` |
| `SQS_DLQ_NAME` | Dead-letter queue | `transcode-jobs-dlq` |
| `SQS_MAX_RECEIVE_COUNT` | Retries before DLQ | `3` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins for API + S3 CORS | `*` (local dev) |
| `ENQUEUE_ENABLED` | Gate SQS dispatch (set `false` to disable) | `true` (implicit) |
| `VITE_S3_ENDPOINT` | Browser-reachable S3 endpoint for presigned URL rewriting | `http://localhost:4566` (local), unset in production |
| `VITE_SAMPLE_VIDEO_URL` | URL for the sample demo video (frontend) | `/sample-video` (Vite proxy) |

---

## Known Limitations

**Docker Compose is the supported workflow** - `fetch('/api/health')` relies on Vite proxy to `http://api:3000` (Docker DNS). This works when web runs in Docker Compose. If running `npm run dev` on host, proxy will fail unless you change the proxy target to `http://localhost:3000`.

**React StrictMode in development** - In development mode, React StrictMode intentionally double-invokes effects to help catch bugs. This causes `useEffect` to run twice, resulting in 2 `/api/health` calls when the page loads. This is expected behavior and helps catch bugs. Production builds don't have this behavior.

---

## Integration Tests

### Upload Flow (requires Docker Compose running)
```bash
# Start services first
docker compose up -d

# Run the upload integration test
./scripts/test-upload-flow.sh
```

This tests the full pipeline: presign → PUT → HEAD → verify size and content type.

### Jobs Flow (requires Docker Compose running)
```bash
# Start services first
docker compose up -d

# Run the jobs integration test
./scripts/test-jobs-flow.sh
```

This tests: presign → upload → create job → idempotency → GET → 404 → SQS message verification.

---

## LocalStack → AWS Transition

### Code: 100% Lift-and-Shift

Because we use the official AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/client-sqs`) pointed at LocalStack, transitioning the NestJS application requires **zero code changes**. Just change environment variables:

| Variable | Local | Production |
|----------|-------|------------|
| `AWS_ENDPOINT_URL` | `http://localstack:4566` | **Remove entirely** (SDK uses default credential chain) |
| `AWS_ACCESS_KEY_ID` | (set by `AWS_ENDPOINT_URL` presence) | IAM task role (ECS) or env var |
| `AWS_SECRET_ACCESS_KEY` | (set by `AWS_ENDPOINT_URL` presence) | IAM task role (ECS) or env var |
| `CORS_ALLOWED_ORIGINS` | `*` | `https://yourdomain.com` |

When `AWS_ENDPOINT_URL` is unset, the SDK uses the default credential provider chain (ECS task role, env vars, `~/.aws/credentials`).

### Infrastructure: Must Be Created Separately

`docker-compose.yml` does not translate to AWS. Production resources must be provisioned:

| Resource | Local (Docker Compose) | Production Options |
|----------|------------------------|--------------------|
| S3 + SQS | LocalStack container | AWS Console / Terraform / CDK |
| PostgreSQL | `postgres:16` container | Neon (free tier), Supabase, or AWS RDS ($15+/mo) |
| API + Worker | Docker containers | AWS ECS, Render, or Railway |

### Deployment Timeline

> **Do not deploy to the public internet until the Abuse Guard issue (Phase 2, Issue 7) is complete.**

Without rate limiting, file size caps, and video duration enforcement, bots can upload massive files and trigger unbounded FFmpeg jobs, running up compute and storage bills. The internet scans every public IP within hours — "security by obscurity" (not sharing the link) does not work.

**Safe order:** Phase 4 (Queues) → Phase 5 (Worker) → Phase 6 (Guardrails) → Deploy.

---

## Known Tech Debt

Pre-existing code quality violations tracked for future cleanup. These predate the Playbook rules and should not block Phase 1 progress.

| Rule Violated | File | Line | Violation | Priority |
|---------------|------|------|-----------|----------|
| Strict Type Safety | `s3.service.ts` | 47, 103 | `catch (error: any)` — should narrow with `instanceof` | Medium |
| Strict Type Safety | `jobs.service.spec.ts` | 9 | `let mockPrisma: any` — use typed mock | Low |
| Strict Type Safety | `dev-user.interceptor.spec.ts` | 9 | `let mockRequest: any` — use typed mock | Low |
| Logging Standard | `logging.interceptor.ts` | 34 | `console.log(...)` — switch to NestJS `Logger` | Medium |
| Logging Standard | `dev-user.interceptor.ts` | 35 | `console.warn(...)` — switch to NestJS `Logger` | Medium |
| TOCTOU Race | `transcode.service.ts` | — | `processJob` uses read-then-write (`findUnique` → `validateJobTransition` → `update`). Safe in Phase 0 — `VisibilityTimeout` prevents concurrent processing — but Phase 2 should use optimistic locking (`Prisma updateMany` with `WHERE status = 'PENDING'`) | Low |