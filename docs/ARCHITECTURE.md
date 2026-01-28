# VTaaS Architecture

## Status
- **Implemented**
  - `api/`: NestJS + Fastify, `GET /api/health` returns `{"status":"ok"}`
  - `docker-compose.yml`: `db` (Postgres), `localstack` (S3+SQS), `api`, `web`
  - Prisma ORM with `jobs` table and migrations
  - `DomainException` base class for typed error codes
  - Jest testing infrastructure
- **Planned (Phase 0 pipeline)**
  - `worker/`: ffmpeg consumer (placeholder)
  - `infra/`: IaC (placeholder)

---

## Overview
VTaaS (Video Transcode as a Service) is a queue-driven media pipeline. The system is designed so the API orchestrates jobs and the worker performs CPU-heavy transcoding work asynchronously.

**Core flow (Phase 0, planned):**
1. Web requests an upload URL from the API
2. Browser uploads directly to object storage using a presigned URL
3. Web requests job creation from the API
4. API writes a job row and enqueues a message
5. Worker consumes the message, transcodes via ffmpeg, uploads outputs, updates job status
6. Web polls job status and displays outputs

---

## Components

### API (`api/`)
**Tech:** NestJS + Fastify  
**Port:** 3000  
**Current state:** only `GET /api/health`

**Responsibilities (Phase 0):**
- Issue presigned upload URLs for input videos
- Create/read job rows in Postgres
- Enqueue transcode jobs to SQS
- Provide job status endpoints for UI polling
- Emit structured request logs (JSON) — see `docs/DECISIONS.md` D-008 for schema

**Non-responsibilities:**
- The API should not stream/relay large video bytes (uploads go direct-to-S3 via presign)
- The API does not run ffmpeg

---

### Worker (`worker/`)
**Tech:** TBD (containerized service that includes `ffmpeg`)  
**Current state:** placeholder

**Responsibilities (Phase 0):**
- Poll SQS for job messages
- Download input from S3
- **Check S3 for existing output at deterministic key before running ffmpeg** (prevents duplicate compute on retries)
- Run ffmpeg transcode(s) if output does not exist
- Upload outputs to S3
- Update job status in Postgres

**Rule:** Only the worker may set `PROCESSING`, `SUCCEEDED`, `FAILED`.

**Output dedupe:** Deterministic output keys (`outputs/{jobId}/{profile}.mp4`) enable safe retries, but the worker must explicitly check S3 for existing output before running ffmpeg to avoid duplicate compute.

---

### Web (`web/`)
**Tech:** React (planned)  
**Current state:** placeholder

**Responsibilities (Phase 0):**
- Call API endpoints to request presigned upload + create jobs
- Upload file directly to S3 using presigned URL
- Poll API for job status and display outputs

---

### Postgres (`db`)
**Port:** 5432  
**Purpose:** Source of truth for job state and metadata.

---

### Object Storage (S3 via LocalStack in Phase 0)
**Port:** 4566 (LocalStack edge port)  
**Buckets (Phase 0 plan):**
- `vtaas-input`
- `vtaas-output`

**Key scheme (Phase 0 plan, locked):**
- Inputs: `inputs/{uuid}.{ext}`
- Outputs: `outputs/{jobId}/{profile}.mp4`

---

### Queue (SQS via LocalStack in Phase 0)
**Port:** 4566 (LocalStack edge port)  
**Queues (Phase 0 plan):**
- `transcode-jobs`
- `transcode-jobs-dlq`

---

## Data model (Phase 0 plan)

### Job status machine (v0)
`PENDING -> PROCESSING -> SUCCEEDED | FAILED`

**Ownership:**
- API creates job row in `PENDING`
- Worker transitions the job into `PROCESSING` and then `SUCCEEDED/FAILED`

### Jobs table (implemented)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `user_id` | text | NOT NULL (dev stub in Phase 0) |
| `request_id` | text | nullable |
| `status` | enum | `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED` |
| `input_key` | text | S3 key for input file |
| `output_keys` | jsonb | nullable, output file references |
| `error` | text | nullable, error message |
| `created_at` | timestamp | auto |
| `updated_at` | timestamp | auto |

**Constraints:**
- Unique `(user_id, input_key)` for idempotency

**Exception handling:**
- `DomainException` for domain-specific errors with typed codes

---

## Interfaces

### Implemented endpoints (today)
- `GET /api/health` -> `{"status":"ok"}`

### Planned endpoints (Phase 0)
- `POST /api/uploads`
  - Input: `{ mimeType, sizeBytes }`
  - Output: `{ url, inputKey, headers }` (presigned PUT)
- `POST /api/jobs`
  - Input: `{ inputKey }`
  - Output: `{ id, status }`
  - Behavior: idempotent by `(user_id, input_key)`
- `GET /api/jobs/:id`
  - Output: `{ id, status, inputKey, outputKeys, error, updatedAt }`

---

## Queue message contract (SQS)

### v0 message schema (Phase 0, locked)
```json
{
  "jobId": "<uuid>",
  "inputKey": "inputs/<uuid>.<ext>",
  "profiles": ["720p"]
}
