# Cursor Playbook (VTaaS)

## Purpose
This file defines how AI assistance is allowed to operate on this repository. The goal is to maximize velocity **without** sacrificing correctness, scope control, or reviewability.

Cursor is a tool. Git is the guardrail. The human is responsible for final decisions.

---

## Sources of truth (in order)
1. The code in the repo (what exists)
2. `docs/ARCHITECTURE.md` (system contract)
3. `docs/DECISIONS.md` (decided choices + rationale)
4. `docs/ROADMAP.md` (what work exists and how it's phased)
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

### Ask, don't assume
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

## Code quality rules (non-negotiable)

### Strict type safety
**You are strictly prohibited from using `any`, `unknown` (as a bypass), or `@ts-ignore`.**

When mocking dependencies in tests, use `jest.mocked()` or `Partial<Type>` with proper typing. When catching errors, type them as `Error` (or a specific subclass) and narrow with `instanceof`.

*Reasoning:* Using `any` defeats the purpose of TypeScript. In a distributed system, bypassing the compiler hides fatal runtime errors that we want to catch at compile time. If a type is difficult to express, that is a signal to fix the type, not suppress the compiler.

> If you ever encounter an edge case where strict typing creates a genuine impasse (not just inconvenience), stop, present the conflict, and ask for permission.

### Logging standard
**Never use `console.log`, `console.warn`, or `console.error`.** Always inject and use the NestJS `Logger`:

```typescript
private readonly logger = new Logger(MyClass.name);
```

*Reasoning:* Standard `console` methods bypass the structured JSON logging middleware we built in Phase 1. We need machine-readable JSON logs for observability. If a component uses `console.*`, it silently breaks log aggregation.

### Unit test isolation
Any file ending in `.spec.ts` must be **completely isolated**. Use the NestJS `TestingModule` to inject mocked providers. Tests must never hit a real database, queue, or storage service.

*Reasoning:* Unit tests must be fast, deterministic, and runnable in CI/CD without spinning up Docker containers. If a unit test hits a real Postgres DB or LocalStack instance, it is a flaky integration test, not a unit test.

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
- Branch name must match the issue's branch requirement (if provided).
- Do not bundle multiple issues into one PR.

---

## Git workflow (hybrid: code vs. documentation)

### Code changes
You are encouraged to auto-commit and merge discrete code implementations once tests pass and AC is met. Code is a milestone — it should be captured in git immediately.

### Documentation changes
**Do NOT auto-commit documentation changes.** This includes:
- Ticking checkboxes in `ROADMAP.md`
- Updating `DECISIONS.md`
- Updating `DEVELOPMENT.md`
- Updating `CURSOR_PLAYBOOK.md`
- Any other markdown-only changes

Leave these changes **uncommitted in the working tree**. Wait for explicit "commit docs" permission from the human.

**Batch-and-tag approach:** When the human approves, batch all pending doc changes into a single `docs:` commit on `main`. This keeps git history clean.

*Reasoning:* Code implementations are discrete milestones. Documentation updates are continuous and iterative; auto-committing every markdown checkbox tick trashes the git history with noise. A single batched `docs:` commit is far more reviewable.

> **Exception:** If a doc change is inseparable from a code change (e.g., adding a new env var requires updating `DEVELOPMENT.md` + `docker-compose.yml` simultaneously), include the doc change in the code commit.

---

## Environment variable discipline (Triple Update Rule)

**Any new environment variable must be added in THREE places:**

| # | Location | Purpose |
|---|----------|---------|
| 1 | `docs/DEVELOPMENT.md` | Human-readable documentation |
| 2 | `docker-compose.yml` (under the relevant service) | Actually gives the container access |
| 3 | `.env.example` | Template for new developers |

*Reasoning:* Documenting a variable in markdown doesn't actually give the code access to it. If it is omitted from `docker-compose.yml`, the container will silently fall back to hardcoded defaults or crash. If `.env.example` is missing it, new developers won't know it exists.

---

## Verification requirements (every PR)
Every implementation must include:
- Exact commands to verify locally (docker compose / curl / tests)
- Expected output (what "success" looks like)
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
- [ ] No `any`, `unknown` bypass, or `@ts-ignore` in changed files
- [ ] No `console.log`/`console.warn`/`console.error` in changed files

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
- a non-negotiable rule (type safety, logging, test isolation, env var triple update) creates a genuine impasse

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

**⚠️ `docs/private/` is gitignored intentionally. Never `git add -f` files in this directory. Maintain them locally only.**

---

## Infrastructure defaults rule (non-negotiable)
**Never accept default values for infrastructure resources without reviewing them.**

Before creating any queue, topic, bucket, or similar resource:
1. List all configurable attributes and their defaults
2. Evaluate whether each default is appropriate for your workload
3. Document any overridden values with rationale in `docs/DECISIONS.md`

Example: SQS default `VisibilityTimeout` is 30 seconds — far too short for video processing. We override to 300s (D-011).