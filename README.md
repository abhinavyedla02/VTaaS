# VTaaS (Video Transcode as a Service)

VTaaS is a local-first, queue-driven video transcoding playground. 

## What does it do?
It is an API and Web UI that allows users to upload raw video files and asynchronously process them into different formats or resolutions (e.g., transcoding a massive 4K `.mov` into web-optimized 720p `.mp4` files). 

The flow is designed to mimic a real-world media pipeline:
1. **Upload**: The client requests a secure upload URL and pushes the massive video file directly to Storage (S3), bypassing the API.
2. **Orchestrate**: The API logs a job in the database and drops a message into a Queue (SQS).
3. **Transcode**: A background Worker consumes the queue message, pulls the video, runs `ffmpeg` to transcode it, and uploads the results.
4. **Serve**: The user polls the API for status updates and downloads the finished files.

## Why build this?
Most side projects are simple CRUD apps (Create, Read, Update, Delete) where the API does all the work synchronously. Real-world systems are rarely that simple. 

VTaaS is built to practice **"production-lite" architecture**. It forces us to solve complex engineering challenges that you only see in distributed systems:
- **Asynchronous Processing**: Dealing with long-running tasks that can't block an HTTP request.
- **Event-Driven Architecture**: Service-to-service communication via SQS queues.
- **State Machines**: Tracking job states (`PENDING` -> `PROCESSING` -> `SUCCEEDED`).
- **Idempotency & Retries**: Ensuring that if a worker crashes halfway through a transcode, the system recovers gracefully without duplicating work.
- **Local Cloud Simulation**: Using `LocalStack` to locally simulate AWS S3 and SQS without spending money or dealing with IAM roles during development.

This repository is intentionally built in phases to practice disciplined, real-world software engineering: small issues, clean PRs, unit/integration tests, and robust boundaries.

---

## Current State

### Implemented
- **Docker Compose services:**
  - PostgreSQL (`db`) on port 5432
  - LocalStack (`localstack`) on port 4566 with S3 + SQS services enabled
  - NestJS API (`api`) on port 3000
  - React Web UI (`web`) on port 5173
- **API endpoints:**
  - `GET /api/health` → `{"status":"ok"}`
  - `POST /api/uploads` → Generates presigned URLs for direct-to-S3 uploads
- **Database (Prisma ORM):**
  - `jobs` table with status enum (`PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`)
  - Unique constraint on `(user_id, input_key)` for idempotency
- **Exception handling:**
  - `DomainException` base class with typed error codes
- **Testing:**
  - Jest with inline config in `package.json`
  - `npm test` to run specs
- **API technology:**
  - NestJS with Fastify adapter  
  - Global route prefix: `/api`

- **Storage:**
  - S3 bucket initialization and CORS configuration via LocalStack
  - Pre-signed URL generation for secure, direct client uploads

### Planned (not implemented yet)
- Job creation + enqueue to SQS (LocalStack)
- Worker service (ffmpeg consumer)
- IaC + staging/prod deployments


---

## Repository Layout

- `api/` — NestJS backend (Fastify adapter). Provides health checks and presigned upload generation. **Implemented.**
- `worker/` — Worker service (planned). Will consume SQS jobs and run ffmpeg. **Empty placeholder.**
- `web/` — React frontend with Vite. Includes an MVP upload form that pushes directly to S3. **Implemented.**
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

# Check web service
curl http://localhost:5173
# Expected: Returns HTML page

# Check web health check proxy
curl http://localhost:5173/api/health
# Expected: {"status":"ok"}

# Check LocalStack health (if healthcheck is added)
curl http://localhost:4566/_localstack/health

# View API logs
docker logs -f vtaas_api
```
