# VTaaS (Video Transcode as a Service)

VTaaS is a local-first, queue-driven video transcoding playground built to practice real-world software engineering: small issues, clean PRs, tests, observability, and (later) cloud deployment.

This repository is intentionally built in phases. The current implementation is minimal but runnable.

---

## Current State

### ✅ Implemented
- **Docker Compose services:**
  - PostgreSQL (`db`) on port 5432
  - LocalStack (`localstack`) on port 4566 with S3 + SQS services enabled
  - NestJS API (`api`) on port 3000
- **API endpoint:**
  - `GET /api/health` → `{"status":"ok"}`
- **API technology:**
  - NestJS with Fastify adapter
  - Global route prefix: `/api`

### ⬜ Planned (not implemented yet)
- Job model + database migrations (Postgres)
- Presigned uploads to S3 (LocalStack)
- Job creation + enqueue to SQS (LocalStack)
- Worker service (ffmpeg consumer)
- Web UI (React)
- IaC + staging/prod deployments
- Structured JSON request logging

### ⚠️ Known Issues
- **LocalStack healthcheck mismatch:** The `api` service depends on `localstack` with `condition: service_healthy`, but LocalStack has no healthcheck defined in `docker-compose.yml`. This may cause the API to start before LocalStack is ready. See `docs/ROADMAP.md` Issue 1.2.1 for planned fix.

---

## Repository Layout

- `api/` — NestJS backend (Fastify adapter). Currently only provides `GET /api/health`. **Real implementation.**
- `worker/` — Worker service (planned). Will consume SQS jobs and run ffmpeg. **Empty placeholder.**
- `web/` — React frontend (planned). Will upload and poll job status. **Empty placeholder.**
- `infra/` — Infrastructure as code (planned). Tool TBD (Terraform or CDK). **Empty placeholder.**
- `docs/` — Project documentation (architecture, roadmap, development, decisions, AI playbook).

---

## Quickstart (Local)

### Prerequisites
- Docker (Docker Desktop or equivalent)
- Node.js 20
- curl (optional, but useful)

### Start services
```bash
docker compose up
```

### Verify services
```bash
# Check API health endpoint
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}

# Check LocalStack health (if healthcheck is added)
curl http://localhost:4566/_localstack/health

# View API logs
docker logs -f vtaas_api
```