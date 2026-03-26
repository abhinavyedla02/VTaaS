# VTaaS Architecture

## Status
- **Implemented**
  - `api/`: NestJS + Fastify, `GET /api/health` and `POST /api/uploads`
  - S3 integration via LocalStack (bucket creation, CORS, presigned URLs)
  - `web/`: React frontend with direct-to-S3 upload MVP
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
**Current state:** Health check (`GET /api/health`) and presigned uploads (`POST /api/uploads`)

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
**Tech:** React + Vite + TypeScript  
**Port:** 5173 (dev), proxies `/api` to `http://localhost:3000`  
**Current state:** Full single-page portfolio UI (Issue 8)

**Component architecture:**

| Component | File | Purpose |
|-----------|------|---------|
| `Hero` | `Hero.tsx` | Title, subtitle, one-liner with gradient text and ambient glow |
| `WhyThisExists` | `WhyThisExists.tsx` | Motivation section — frames the project as intentional engineering |
| `DemoWidget` | `DemoWidget.tsx` | Full lifecycle: name → resolution selector → file upload → polling → video player / error |
| `SystemDiagram` | `SystemDiagram.tsx` | Data-driven SVG pipeline diagram (two-row layout: processing + storage) |
| `AboutStack` | `AboutStack.tsx` | 7-item tech stack grid |
| `WhatsNext` | `WhatsNext.tsx` | Future-work section (AI, Auth, Observability) |

**Design system:**
- CSS variables in `App.css` — dark-mode-only, blue accent palette
- Typography: Inter (sans) + JetBrains Mono (mono) via Google Fonts CDN
- No CSS framework (vanilla CSS, no Tailwind)
- Each component has a co-located `.css` file

**System diagram:**
- Static SVG rendered from data arrays (`NODES`, `EDGES`)
- Two-row layout: processing pipeline (Browser → API → SQS → Worker) on top, storage (S3 inputs, S3 outputs) on bottom
- Issue 10: interactive — nodes and edges highlight dynamically based on `DemoStatus` and `jobStatus` props

**Manual diagram progression (Issue 10.5):**
- `diagramStage` (0–6) controls which nodes are highlighted, advanced via "Next →" button
- Button disables when user catches up to real pipeline state (prevents advancing past reality)
- Succeeded auto-sets to stage 6; failed shows worker node with error styling
- More engaging than auto-buffering — each click teaches what happens at that pipeline stage

**Sample video demo (Issue 10.5):**
- "Try with Sample Video" button fetches from `/sample-video` (Vite proxy → LocalStack)
- `VITE_SAMPLE_VIDEO_URL` env var overrides the proxy path for production (e.g., CloudFront URL)
- Fetched as a Blob, converted to a File, then uploaded through the normal presigned URL flow
- Pre-fills submitter name to "Demo User" and resolution to 360p

**Responsibilities:**
- Call API endpoints to request presigned upload + create jobs
- Upload file directly to S3 using presigned URL
- Client-side file validation (type allowlist + 20MB size cap) before upload
- Poll `GET /api/jobs/:id` every 2s for status updates; stop on terminal state (SUCCEEDED/FAILED)
- On SUCCEEDED: render HTML5 `<video>` player with presigned GET URL; show Download button
- On FAILED: display error message with "Try Again" reset button
- Resolution selector: user picks output resolution (240p–1080p), threaded into `POST /api/jobs` body

---

### Postgres (`db`)
**Port:** 5432  
**Purpose:** Source of truth for job state and metadata.

---

### Object Storage (S3 via LocalStack in Phase 0)
**Port:** 4566 (LocalStack edge port)  
**Buckets (Phase 0 plan):**
- `vtaas-inputs`
- `vtaas-outputs` (created by Worker in Issue 5)
- `vtaas-samples` (created by LocalStack init script; holds sample demo video)

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
- `POST /api/uploads`
  - Input: `{ mimeType, sizeBytes }`
  - Output: `{ url, inputKey, expiresIn }` (presigned PUT)
- `POST /api/jobs`
  - Input: `{ inputKey, submitterName?, note?, resolution? }`
  - Output: `{ id, status, submitterName, note }`
  - Behavior: idempotent by `(user_id, input_key)`
  - `resolution` validated via `@IsIn(['240p','360p','480p','720p','1080p'])`, defaults to `720p`
- `GET /api/jobs/:id`
  - Output: `{ id, status, inputKey, outputKeys, error, updatedAt, downloadUrl }`
  - `downloadUrl` is a presigned GET URL (15min TTL) — populated only when status is `SUCCEEDED` and `outputKeys` is non-empty

---

## Queue message contract (SQS)

### v0 message schema (Phase 0, updated for resolution)
```json
{
  "jobId": "<uuid>",
  "inputKey": "inputs/<uuid>.<ext>",
  "profiles": ["720p"]
}
```

`profiles` now carries the user-selected resolution (e.g. `["480p"]`). The worker's `FfmpegService` maps profile strings to ffmpeg scale filters via a `PROFILE_SCALE_HEIGHT` lookup. Output key uses the profile: `outputs/{jobId}/{profile}.mp4`.

---

## Production Deployment Notes

- **Sample video:** Should be served from CloudFront or a public S3 bucket. `VITE_SAMPLE_VIDEO_URL` must be set to the production URL at build time.
- **`infra/sample.mp4`:** In `.gitignore` (large binary). For production, upload directly to S3. Consider Git LFS if the file needs to be tracked.
- **`VITE_SAMPLE_VIDEO_URL`:** Baked into the frontend at build time by Vite. Must point to a publicly accessible URL in production.
