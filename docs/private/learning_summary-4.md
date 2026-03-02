# Learning Summary: Issue 4 (Create Job → Enqueue)

This document captures what I'm learning as I build the job creation and SQS enqueue pipeline for VTaaS.

---

## 4.1 SQS Infrastructure

### What We Built

An SQS client that connects to LocalStack and automatically creates the transcode queue and its dead-letter queue when the app starts.

### The One-Liner

> "I set up SQS infrastructure with a dead-letter queue and a 5-minute visibility timeout to prevent duplicate video processing."

---

### Key Concepts

**1. CreateQueue is Idempotent (unlike S3)**

Unlike S3 where you need HeadBucket → CreateBucket, SQS's `CreateQueueCommand` is inherently idempotent. Calling it on an existing queue with the same attributes simply returns the URL.

```
S3 pattern:  HeadBucket → 404? → CreateBucket
SQS pattern: CreateQueue → always returns URL
```

**Interview tip:** "SQS CreateQueue is idempotent — you don't need a check-then-create pattern. This simplifies startup code and eliminates race conditions between multiple instances."

---

**2. Dead-Letter Queues (DLQ)**

A DLQ catches messages that fail processing repeatedly. After `maxReceiveCount` failures, the message moves to the DLQ instead of being retried forever.

```
transcode-jobs ──(3 failures)──→ transcode-jobs-dlq
```

**Why this matters:** Without a DLQ, a poison message (e.g., corrupt video file) would block the queue forever — each retry fails, it goes back, gets picked up, fails again.

**Interview tip:** "I configured a dead-letter queue with `maxReceiveCount: 3`. After three processing failures, the message moves to a separate queue for investigation. This prevents poison messages from blocking the entire pipeline."

---

**3. VisibilityTimeout — The Critical Default You Must Override**

When a worker picks up a message, SQS hides it from other workers for `VisibilityTimeout` seconds. If the worker doesn't delete it in time, the message reappears and another worker picks it up.

**AWS default: 30 seconds.** Video transcoding takes minutes. This means:
- Worker A picks up job, starts processing
- 30 seconds later, SQS thinks Worker A died
- Worker B picks up the same job → duplicate processing

**Our fix:** Set `VisibilityTimeout: 300` (5 minutes).

**Interview tip:** "The default SQS visibility timeout is 30 seconds, which is way too short for video processing. I set it to 5 minutes to prevent duplicate work. In production, I'd implement heartbeat-based visibility extension for variable-length jobs."

---

**4. RedrivePolicy — Linking Queue to DLQ**

The main queue needs to know where its DLQ is. You do this by:
1. Create DLQ first
2. Get its ARN (Amazon Resource Name — the unique identifier)
3. Pass the ARN in RedrivePolicy when creating the main queue

**The order matters.** You can't reference a DLQ that doesn't exist yet.

---

### What I Learned the Hard Way

**1. Always question infrastructure defaults**

I initially forgot to set `VisibilityTimeout`. The code worked, tests passed, but in production this would have caused duplicate processing. Infrastructure defaults that "just work" in dev can be silent bugs in production.

**Lesson:** For every queue/topic/bucket you create, review all configurable attributes and their defaults.

---

### How to Talk About This

**Q: How do you prevent duplicate message processing?**

> "Two mechanisms: visibility timeout and dead-letter queues. The visibility timeout hides messages from other workers while one is processing. If processing fails repeatedly, the DLQ catches it so it doesn't loop forever."

**Q: Why not just use a longer visibility timeout?**

> "A fixed timeout is a tradeoff — too short causes duplicates, too long delays retries. In production, I'd implement a heartbeat pattern where the worker extends visibility while actively processing, so failed workers are detected quickly."

---

### Files to Review

| File | What it demonstrates |
|------|---------------------|
| [sqs.service.ts](file:///Users/abhinavyedla/Documents/Github%20Projects/VTaaS/VTaaS/api/src/common/sqs/sqs.service.ts) | SQS client, queue + DLQ creation, VisibilityTimeout |
| [sqs.service.spec.ts](file:///Users/abhinavyedla/Documents/Github%20Projects/VTaaS/VTaaS/api/src/common/sqs/sqs.service.spec.ts) | Mocking AWS SDK in tests |
| [sqs.module.ts](file:///Users/abhinavyedla/Documents/Github%20Projects/VTaaS/VTaaS/api/src/common/sqs/sqs.module.ts) | Global module pattern (same as S3) |

---

## 4.2 Queue Client Wrapper (`enqueueTranscode`)

### What We Built

A typed method that serializes a job into a JSON message and sends it to SQS, following the locked D-007 message contract.

### The One-Liner

> "The enqueue wrapper sends a self-contained message so the worker can process without querying the database."

---

### Key Concepts

**1. Self-Contained Messages**

The SQS payload contains everything the worker needs:

```json
{
  "jobId": "uuid",
  "inputKey": "inputs/abc.mp4",
  "profiles": ["720p"]
}
```

The worker can: download file (via `inputKey`), transcode (via `profiles`), and update status (via `jobId`) — all without querying the database first.

**Why this matters:** Database lookups add latency and coupling. If the DB is slow, the worker is slow. Self-contained messages let workers be autonomous.

**Interview tip:** "I designed the SQS message to be self-contained — it has the S3 key, the job ID, and the transcode profiles. The worker doesn't need a database query to start processing. This reduces coupling and improves resilience."

---

**2. Message Contracts Are APIs**

The D-007 decision document locks the message schema. Changing the message shape requires a versioned migration — just like a REST API.

**Interview tip:** "I treat queue message schemas like API contracts. They're versioned and documented. Both producer (API) and consumer (worker) depend on the same contract."

---

**3. Cached Queue URL**

The queue URL is resolved once during `onModuleInit` and cached. Every `enqueueTranscode` call reuses it — no extra SQS API call per message.

---

### Files to Review

| File | What it demonstrates |
|------|---------------------|
| [sqs.service.ts](file:///Users/abhinavyedla/Documents/Github%20Projects/VTaaS/VTaaS/api/src/common/sqs/sqs.service.ts) | `TranscodePayload` interface + `enqueueTranscode()` |
| [sqs.service.spec.ts](file:///Users/abhinavyedla/Documents/Github%20Projects/VTaaS/VTaaS/api/src/common/sqs/sqs.service.spec.ts) | Testing payload serialization + D-007 shape |


