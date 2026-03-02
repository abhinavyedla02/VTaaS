# Development (Local)

## Prerequisites
- Docker (Docker Desktop or equivalent)
- Node.js 20 (this repo is pinned to Node 20)
- curl (for quick endpoint checks)
- jq (for JSON parsing in integration tests: `brew install jq`)
- awslocal CLI (for LocalStack debugging: `pip install awscli-local`)

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

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DEV_USER_ID` | Override default user ID for dev | (none, falls back to `LocalDevUser`) |
| `REQUEST_LOGGING_ENABLED` | Enable/disable JSON request logs | `true` |
| `MAX_UPLOAD_SIZE_BYTES` | Max file size for uploads | `524288000` (500MB) |
| `UPLOAD_EXPIRY_SECONDS` | Presigned URL expiry time | `900` (15min) |
| `AWS_ENDPOINT_URL` | LocalStack endpoint | `http://localstack:4566` (Docker) |
| `AWS_REGION` | AWS region for S3/SQS client | `us-east-1` |
| `SQS_QUEUE_NAME` | Main transcode queue | `transcode-jobs` |
| `SQS_DLQ_NAME` | Dead-letter queue | `transcode-jobs-dlq` |
| `SQS_MAX_RECEIVE_COUNT` | Retries before DLQ | `3` |
| `ENQUEUE_ENABLED` | Gate SQS dispatch (set `false` to disable) | `true` (implicit) |

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

---

## LocalStack → AWS Transition

### Code: 100% Lift-and-Shift

Because we use the official AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/client-sqs`) pointed at LocalStack, transitioning the NestJS application requires **zero code changes**. Just change environment variables:

| Variable | Local | Production |
|----------|-------|------------|
| `AWS_ENDPOINT_URL` | `http://localstack:4566` | **Remove entirely** |
| `AWS_ACCESS_KEY_ID` | `test` | Real IAM credentials |
| `AWS_SECRET_ACCESS_KEY` | `test` | Real IAM credentials |

The SDK auto-detects real AWS and routes `SqsService`/`S3Service` calls to the cloud.

### Infrastructure: Must Be Created Separately

`docker-compose.yml` does not translate to AWS. Production resources must be provisioned:

| Resource | Local (Docker Compose) | Production Options |
|----------|------------------------|--------------------|
| S3 + SQS | LocalStack container | AWS Console / Terraform / CDK |
| PostgreSQL | `postgres:16` container | Neon (free tier), Supabase, or AWS RDS ($15+/mo) |
| API + Worker | Docker containers | AWS ECS, Render, or Railway |

### Deployment Timeline

> **Do not deploy to the public internet until Phase 6 (Guardrails) is complete.**

Without Issue 6.1 (strict file size limits) and 6.2 (rate limiting), bots can upload massive files and trigger unbounded FFmpeg jobs, running up compute and storage bills. The internet scans every public IP within hours — "security by obscurity" (not sharing the link) does not work.

**Safe order:** Phase 4 (Queues) → Phase 5 (Worker) → Phase 6 (Guardrails) → Deploy.