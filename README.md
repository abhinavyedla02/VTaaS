# VTaaS — Video Transcode as a Service

> A production-grade, queue-driven video transcoding pipeline built as a portfolio piece.  
> Upload a video. Watch it transcode. Download the output. Powered by a real AWS-native distributed system.

**[Live Demo](#)** · [Architecture](#architecture) · [Quickstart](#quickstart-local)

---

## What It Does

VTaaS accepts raw video files via a browser upload form, asynchronously transcodes them to 720p MP4, and streams the result back — without the API ever touching the raw video bytes. The pipeline mirrors how real media platforms like YouTube and Vimeo process video at scale.

```
Browser → API (presign) → S3 (direct upload) → SQS → Worker (ffmpeg) → S3 (output) → Browser
```

Every component is independently scalable, fault-tolerant, and observable.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser / Web UI                        │
│                     React + Vite (port 5173)                    │
└────────────────────┬───────────────────┬────────────────────────┘
                     │ 1. Request presign │ 6. Poll job status
                     ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        NestJS API (port 3000)                    │
│         Fastify · Prisma · @aws-sdk/client-s3 + sqs             │
└──────┬──────────────────────────────────┬───────────────────────┘
       │ 2. Presigned PUT URL             │ 4. Enqueue job
       ▼                                  ▼
┌──────────────┐                  ┌────────────────┐
│  S3 (inputs) │◄── 3. PUT video  │  SQS           │
│  vtaas-inputs│                  │  transcode-jobs│
└──────────────┘                  └───────┬────────┘
                                          │ 5. Consume message
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         NestJS Worker                            │
│              ffmpeg · @aws-sdk · Prisma · SQS long poll         │
│  PENDING → PROCESSING → SUCCEEDED | FAILED                      │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ Upload transcoded output
                                   ▼
                          ┌──────────────────┐
                          │  S3 (outputs)    │
                          │  vtaas-outputs   │
                          └──────────────────┘
```

**State machine:** `PENDING → PROCESSING → SUCCEEDED | FAILED`  
**Idempotency:** Deterministic S3 output keys (`outputs/{jobId}/720p.mp4`) enable safe retries — the worker checks for existing output before running ffmpeg.  
**Deduplication:** Unique `(user_id, input_key)` constraint prevents duplicate job creation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | NestJS · Fastify · TypeScript |
| Worker | NestJS · TypeScript · ffmpeg |
| Database | PostgreSQL · Prisma ORM |
| Queue | AWS SQS (LocalStack in dev) |
| Storage | AWS S3 (LocalStack in dev) |
| Frontend | React · Vite · TypeScript |
| Testing | Jest · 120 tests across 3 workspaces |
| Infrastructure | Docker · Docker Compose · LocalStack |

---

## Current Implementation Status

| Phase | Issue | Status |
|---|---|---|
| Core Engine | Repo + Compose + DB schema | ✅ Done |
| Core Engine | Presigned S3 upload | ✅ Done |
| Core Engine | Job creation + SQS enqueue | ✅ Done |
| Core Engine | Worker scaffold + monorepo | ✅ Done |
| Core Engine | SQS consumer + S3 output dedupe | ✅ Done |
| Core Engine | Transcode execution + state machine | ✅ Done |
| Core Engine | End-to-end verification | ⬜ Next |
| Hardening | CI (GitHub Actions) | ⬜ Planned |
| Hardening | Abuse guard + cleanup cron | ⬜ Planned |
| Portfolio UI | React frontend polish + video player | ⬜ Planned |
| Deployment | AWS ECS Fargate + Vercel | ⬜ Planned |

---

## Repository Layout

```
vtaas/
├── api/              NestJS API — presigned uploads, job creation, SQS enqueue
├── worker/           NestJS Worker — SQS consumer, ffmpeg transcode, S3 output
├── web/              React + Vite frontend — upload form, job status polling
├── packages/
│   └── db/           Shared Prisma client + schema + job state machine (used by API + Worker)
├── infra/            Infrastructure as code (planned — AWS CDK or Terraform)
├── docs/             Architecture, decisions, roadmap, development guide, playbook
└── scripts/          Integration test scripts
```

---

## Quickstart (Local)

### Prerequisites
- Docker Desktop
- Node.js 20
- `curl` · `jq` · `awslocal` (optional, for LocalStack inspection)

### First-time setup
```bash
# Install dependencies
npm install

# Build the shared @vtaas/db package (generates types for local IDE + tsc)
npm run build --workspace=@vtaas/db
```

> Docker handles the `@vtaas/db` build automatically during `docker compose build`.  
> This step is only needed for local TypeScript resolution before running the containers.

### Start all services
```bash
docker compose up
```

This starts: **Postgres** (5432) · **LocalStack S3+SQS** (4566) · **API** (3000) · **Worker** · **Web UI** (5173)

### Verify
```bash
# API health
curl http://localhost:3000/api/health
# → {"status":"ok"}

# Web UI
open http://localhost:5173

# LocalStack queues
awslocal sqs list-queues
# → transcode-jobs, transcode-jobs-dlq

# Run all tests (120 across 3 workspaces)
npm test --workspaces --if-present
```

### Run integration tests
```bash
# Full upload → job create → SQS verify flow
./scripts/test-jobs-flow.sh
```

---

## What's Next

The core pipeline is complete. Coming next:

- **Abuse Guard** — IP rate limiting, video duration cap (60s), 24hr data cleanup cron
- **Portfolio UI** — polished React frontend with live demo, job status progress, video player
- **AWS Deployment** — ECS Fargate (API + Worker), Vercel (frontend), Neon (Postgres), real S3 + SQS
- **Pipeline Diagram** — interactive architecture diagram embedded in the portfolio site

**Future tier (not in scope):** AI upscaling via Real-ESRGAN — a Python worker running on GPU-enabled ECS Fargate, consuming a separate `transcode-jobs-ai` SQS queue to produce 1080p AI-enhanced output from 720p source.

---

## License

MIT
