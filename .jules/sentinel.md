## 2026-09-20 - Pre-Active State Idempotency Key Evaluation
**Vulnerability:** In `web-execution.mjs`, `submit` and `executeRuntimeApproved` checked `assertActive(run)` before checking for prior commits via `store.getCommit(idempotencyKey)`. Because completed web runs transition to `COMPLETED`, retrying a submission with the same idempotency key threw a state exception (`web run completed`) rather than safely returning the duplicate committed payload.
**Learning:** Checking lifecycle states before idempotency keys breaks retry idempotency on completed state machines and can expose unexpected internal errors to clients.
**Prevention:** Always check stored idempotency keys and return committed results before validating active lifecycle state requirements on mutation endpoints.
