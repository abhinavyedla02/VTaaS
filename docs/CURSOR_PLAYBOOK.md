# Cursor Playbook (VTaaS)

## Purpose
This file defines how AI assistance is allowed to operate on this repository. The goal is to maximize velocity **without** sacrificing correctness, scope control, or reviewability.

Cursor is a tool. Git is the guardrail. The human is responsible for final decisions.

---

## Sources of truth (in order)
1. The code in the repo (what exists)
2. `docs/ARCHITECTURE.md` (system contract)
3. `docs/DECISIONS.md` (decided choices + rationale)
4. `docs/ROADMAP.md` (what work exists and how it’s phased)
5. `docs/DEVELOPMENT.md` (how to run + verify)

If something is not in one of these sources, it is **not a fact**.

---

## Operating mode (non-negotiable)

### Evidence-first
When answering questions about the repo, always reference exact files.  
If you cannot verify something from the repository, you must say **unknown** and ask for clarification.

### Plan-first (no edits)
Before writing or modifying code, you must:
1. Restate the goal (from the issue AC)
2. List the exact files you will change/add
3. Describe the minimal approach
4. List verification commands + expected output
5. List rollback approach

No edits until the plan is provided.

### Ask, don’t assume
If any requirement is ambiguous (contract shape, naming, env var name, key format, etc.), ask.

---

## Architectural Standards (The "Where" & "How")

### 1. Separation of Concerns
- **Pure Logic:** Business rules (state machines, validation, calculations) go in **helper files** (e.g., `*.rules.ts`, `*.domain.ts`). These must be pure functions/classes and easy to unit test.
- **Services:** Orchestrate I/O (Database, SQS, S3) and call Pure Logic.
- **Controllers:** Parse HTTP input, call Services, and map responses. Do not put business logic here.

### 2. File Organization
- Feature-based folders: `api/src/features/<feature>/` (e.g., `api/src/jobs/`).
- Shared logic: `api/src/common/`.
- Tests: Co-located with the file (e.g., `job.rules.ts` -> `job.rules.spec.ts`).

### 3. Naming Conventions
- **Error Codes:** `SCREAMING_SNAKE_CASE` (e.g., `INVALID_JOB_TRANSITION`).
- **Files:** `kebab-case.ts`.
- **Classes:** `PascalCase`.
- **Variables/Methods:** `camelCase`.

---

## Diff discipline

### Keep diffs small
- Minimal changes needed to satisfy AC
- Do not refactor unrelated code
- Do not rename/move files unless the issue explicitly calls for it

### Dependencies are frozen
- Do not add, remove, or upgrade dependencies unless the issue explicitly requires it.
- If you believe a dependency change is necessary, stop and ask.

### One issue, one branch
- Branch name must match the issue’s branch requirement (if provided).
- Do not bundle multiple issues into one PR.

---

## Verification requirements (every PR)
Every implementation must include:
- Exact commands to verify locally (docker compose / curl / tests)
- Expected output (what “success” looks like)
- Proof artifact text to paste into PR (log line, curl output, CLI output)
- Rollback instructions (env flag preferred when relevant)

If verification cannot be performed due to missing setup, stop and ask.

### Pre-flight check (before implementation)
Before starting implementation that touches Docker or adds dependencies:
1. Verify `docker compose up --build` succeeds on current branch
2. Verify all required env vars are documented and set in docker-compose
3. Review Dockerfile for any missing build steps (e.g., prisma generate)

This catches pre-existing infrastructure gaps before they become blockers.

---

## Repository facts (verified)
- API is NestJS + Fastify.
- Global prefix is `/api`.
- Ports (docker compose):
  - API: 3000
  - Postgres: 5432
  - LocalStack: 4566
- Current implemented endpoint: `GET /api/health`.

---

## PR checklist (must be satisfied)
- [ ] AC satisfied (explicitly checked off in PR description)
- [ ] Proof included (copy/paste artifact)
- [ ] Rollback documented and works
- [ ] No unrelated changes
- [ ] Verification commands provided
- [ ] Any new env vars documented (name + purpose + defaults)

---

## Recommended prompt pattern

### 1) Plan-only prompt
"Scan the repo and propose a minimal plan for Issue X. Do not modify files. List exact files to change, verification commands, and rollback."

### 2) Implement prompt
"Implement exactly the approved plan. Minimal diff. No unrelated refactors. Summarize file-by-file changes."

### 3) Self-review prompt
"Review your diff against AC. List risks. Confirm verification steps and provide proof artifact."

### 4) Implementation report (mandatory)
After completing any implementation, provide a detailed report including:
- **What went as planned:** Items from the plan that executed without issues
- **Blockers encountered:** Any errors, failures, or unexpected behavior
- **Retries and fixes:** What was attempted and how it was resolved
- **Deviations from plan:** Any changes not in the original plan, with rationale
- **Tech debt exposed:** Pre-existing issues surfaced during implementation
- **Commits made:** List of commits with their purpose

This transparency ensures the human understands exactly what happened and can make informed decisions about merging.

---

## Stop conditions (ask the human)
Stop and ask if:
- the contract (API shape, message schema, key scheme) is unclear or conflicting
- a dependency change would be required
- a file rename/move would be required
- behavior would change outside the requested scope
- there are multiple plausible approaches and the issue does not specify which to choose
- healthcheck tooling (curl/wget) availability is uncertain

---

## Healthcheck tooling rule (non-negotiable)
**Do not assume curl/wget exists in container images for healthchecks.**

- Before using `curl` or `wget` in a healthcheck, verify the tool exists in the image.
- Prefer `CMD-SHELL` with fallbacks or use built-in tools (e.g., `pg_isready` for Postgres).
- If a tool must be used, document the requirement and verify it exists in the base image.
- Example: LocalStack healthcheck must not assume `curl` exists without verification.

---

## Quick start (resume checklist)
When starting a new session or resuming work:
1. Read `docs/ROADMAP.md` to identify current issue and phase
2. Read `docs/DECISIONS.md` for locked contracts and prior decisions
3. Read `docs/ARCHITECTURE.md` for component responsibilities
4. Check `git status` and `git log --oneline -5` for workspace state
5. Run `npx jest` to confirm all existing tests pass before editing
6. Review `docs/private/learning_summary-{N}.md` for the current issue — add a new section per sub-issue as you complete work

---

## Learning summary requirement (per sub-issue)
After completing each sub-issue, update the corresponding `docs/private/learning_summary-{issue}.md` with:
- **What We Built** — one paragraph summary
- **The One-Liner** — a resume/interview-ready quote
- **Key Concepts** — numbered, with interview tips
- **What I Learned the Hard Way** — gotchas and non-obvious lessons
- **How to Talk About This** — Q&A format for interview prep
- **Files to Review** — table linking to relevant source files

This is a living document — append new sections as sub-issues are completed.

---

## Infrastructure defaults rule (non-negotiable)
**Never accept default values for infrastructure resources without reviewing them.**

Before creating any queue, topic, bucket, or similar resource:
1. List all configurable attributes and their defaults
2. Evaluate whether each default is appropriate for your workload
3. Document any overridden values with rationale in `docs/DECISIONS.md`

Example: SQS default `VisibilityTimeout` is 30 seconds — far too short for video processing. We override to 300s (D-011).