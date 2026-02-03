
---

## `docs/DECISIONS.md`

```markdown
# Decisions (ADR-lite)

## How to use this file
- This file records decisions that affect multiple parts of the system.
- Each decision includes: status, rationale, and consequence.
- If a decision changes, update it via PR and include the reason.

---

## D-001: NestJS + Fastify for API
- **Status:** Decided (implemented)
- **Rationale:** Current API is NestJS and explicitly uses the Fastify adapter.
- **Consequence:** API patterns should follow NestJS + Fastify conventions; avoid introducing Express-specific middleware assumptions.

---

## D-002: Local-first development via Docker Compose
- **Status:** Decided (implemented)
- **Rationale:** Compose provides consistent local orchestration of API + DB + LocalStack.
- **Consequence:** All Phase 0 functionality must be runnable via `docker compose up`.

---

## D-003: AWS emulation via LocalStack (S3 + SQS) in Phase 0
- **Status:** Decided (implemented for service availability; integration planned)
- **Rationale:** Provides local equivalents for storage and queue without AWS usage.
- **Consequence:** API/worker AWS clients must support LocalStack endpoint configuration.

---

## D-004: Phase 0 uses `user_id` as NOT NULL (dev stub)
- **Status:** Decided
- **Rationale:** Phase 0 idempotency is defined as unique `(user_id, input_key)`. If `user_id` is nullable, Postgres uniqueness allows multiple NULLs, breaking idempotency.
- **Consequence:** Phase 0 job creation must always resolve a non-null user id (env-based dev user is acceptable until auth exists).

---

## D-005: Upload mechanism in Phase 0 uses presigned PUT
- **Status:** Decided
- **Rationale:** Presigned PUT is simplest for Phase 0 pipeline wiring and testing.
- **Consequence:**
  - Content-Type can be enforced by signing required headers.
  - Size enforcement is "validate before issuing URL" and must be verified (e.g. HEAD) before job creation/enqueue.

---

## D-006: Canonical object key scheme
- **Status:** Decided
- **Inputs:** `inputs/{uuid}.{ext}`
- **Outputs:** `outputs/{jobId}/{profile}.mp4`
- **Rationale:** Deterministic keys simplify retries, idempotency, cleanup, and debugging.
- **Consequence:** API/worker/web must treat keys as contract; changes require versioning and documentation.

---

## D-007: SQS message schema includes `profiles` from v0
- **Status:** Decided
- **Schema (v0):**
```json
{
  "jobId": "<uuid>",
  "inputKey": "inputs/<uuid>.<ext>",
  "profiles": ["720p"]
}
```

---

## D-008: Logging v0 schema (structured JSON request logs)
- **Status:** Decided (not implemented)
- **Schema (exact):** `{ level, msg, requestId, path, method }`
- **Optional behavior:** If client sends `x-request-id` header, use it as `requestId`; otherwise generate UUID.
- **Rationale:** Structured logs enable parsing and observability. Minimal schema for Phase 0.
- **Consequence:** All request logs must include these exact fields. Implementation must use this schema. See `docs/ARCHITECTURE.md` API section for reference.

---

## D-009: Mime type allowlist and extension mapping
- **Status:** Decided
- **Allowlist (Phase 0):**
  | Mime Type | Extension |
  |-----------|-----------|
  | `video/mp4` | `mp4` |
  | `video/quicktime` | `mov` |
  | `video/webm` | `webm` |
- **Rationale:** Strict allowlist prevents unexpected file types; mapping ensures consistent S3 key extensions.
- **Consequence:** 
  - API rejects upload requests with unsupported mime types (`UNSUPPORTED_MIME_TYPE` error code)
  - Worker can expect only these extensions in input keys
  - Expand allowlist via PR when needed

---

## D-010: Upload size and URL expiry limits
- **Status:** Decided
- **Limits (Phase 0):**
  | Limit | Env Var | Default |
  |-------|---------|---------|
  | Max file size | `MAX_UPLOAD_SIZE_BYTES` | `524288000` (500MB) |
  | Presigned URL expiry | `UPLOAD_EXPIRY_SECONDS` | `900` (15min) |
- **Rationale:** Reasonable defaults for local dev; configurable for staging/prod.
- **Consequence:**
  - API rejects upload requests exceeding size limit (`FILE_TOO_LARGE` error code)
  - Presigned URLs expire after configured duration
  - HEAD check before job creation verifies actual uploaded size