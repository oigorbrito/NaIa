# CHASSIS FORMAL RUNTIME LIFECYCLE STRUCTURAL AUDIT — 2026-09-01

SCOPE = CHASSIS_ONLY
CLASSIFICATION = STRUCTURAL_AUDIT / NOT_RUNTIME_VERIFIED
REMOTE_RUNTIME_STATUS = BLOCKED_REMOTE_CI_PRE_RUNNER
BENCHMARK_TO_BEAT = NOT_SELECTED
CHASSIS_WINNER = NOT_SELECTED

## Purpose

Audit the newly introduced candidate-specific formal runtime lifecycles before allowing pilot evidence to enter the preregistered formal ledger. This record is source-level evidence only. It is not a runtime PASS for any chassis or cleanup lifecycle.

## Audited chain

The formal single-run creates a private per-experiment runtime environment, resolves a candidate-specific lifecycle, and passes that lifecycle into `executeCandidateExperiment`.

`executeCandidateExperiment` establishes candidate-owned lifecycle infrastructure before setup inspection, preserves the pre-run receipt, and converts an unverified receipt into `BLOCKED_SETUP`. The run hook executes only when setup is `READY`.

`executeExperiment` invokes cleanup in `finally`. A cleanup failure forces the experiment verdict to `INCONCLUSIVE`; it cannot become candidate PASS or FAIL.

Temporal formal lifecycle structurally provides:

- exact Linux/x64 execution profile;
- exact Temporal CLI binary SHA-256;
- exact CLI/server version check;
- fresh temporary workspace and SQLite durable store;
- experiment-specific loopback port and task queues;
- health check before execution;
- exact server shutdown, SQLite/workspace removal, and observed-PID liveness verification.

DBOS formal lifecycle structurally provides:

- exact Linux/x64 execution profile;
- PostgreSQL image pinned by digest;
- experiment-specific container identity;
- proof that the container name did not exist before lifecycle ownership is asserted;
- isolated loopback port and DBOS database URL;
- TCP readiness check;
- database drop/absence verification;
- removal only of the experiment-owned container;
- workspace removal and observed-PID liveness verification.

## Findings and fixes

### F1 — common-runner process PID provenance gap

T7 already preserved the killed process PID through `runUntilKillpoint`, but T8/T15 `runUntilTerminal` and status `runToExit` did not preserve child PIDs. A formal cleanup receipt could therefore have insufficient worker-process evidence for those paths.

Fix: commit `6711c76fa704f9340b7d121efe998bab266ef010` records child PIDs in terminal/status process observations. No evaluator, fault-injection criterion, or candidate verdict rule changed.

### F2 — formal ledger admission did not enforce runtime-verified cleanup support

The round-robin ledger validator previously checked schema and preregistered identity but did not consult `FORMAL_CLEANUP_SUPPORT`. A structurally implemented but not runtime-verified lifecycle could therefore produce a schema-valid record that was not explicitly barred from append by this gate.

Fix: commit `65994afaba14f9a7ce897f568fee5825bf8b361f` adds formal ledger admission requiring both:

1. candidate formal cleanup support explicitly verified (`preRunCleanup=true` and `postRunCleanup=true`); and
2. record provenance `formalRuntimeLifecycle.status=RUNTIME_VERIFIED`.

READY formal executions additionally require `cleanup.status=PASS`.

### F3 — benchmark eligibility could be evaluated on records outside the formal ledger

`benchmarkEligible()` previously validated record semantics/repetition completeness but did not independently require runtime-verified lifecycle provenance.

Fix: commit `b9ee789b24094260e8b870e30ef400c7558bfbc4` requires `RUNTIME_VERIFIED` formal lifecycle provenance and `cleanup.status=PASS` for READY records before benchmark eligibility.

### F4 — admission gate tests added but not executed remotely

Commit `b7699c15ac399e0d884e6b2a5671a8f8a354a426` adds tests proving that:

- implemented-but-unverified lifecycle provenance is rejected;
- runtime-verified provenance is still rejected while cleanup support remains closed;
- READY execution with non-PASS cleanup is rejected;
- admission opens only when lifecycle provenance and cleanup support are both verified;
- benchmark eligibility rejects pilot/unverified lifecycle records.

These tests are IMPLEMENTED_NOT_RUNTIME_VERIFIED because remote CI is blocked before runner steps.

### F5 — DBOS cleanup-support metadata was stale

DBOS lifecycle code existed while `formal-cleanup-support.mjs` still represented DBOS only as `false/false` without implementation provenance.

Fix: commit `ed1dd238aa19909d22327b9ce158a4b6e0db17b0` records the implementation path and status `IMPLEMENTED_NOT_RUNTIME_VERIFIED` while deliberately keeping both cleanup-support booleans false.

## Remote CI blocker

Observed run `33522581795` for commit `b7699c15ac399e0d884e6b2a5671a8f8a354a426`:

- Node 24 job: completed/failure, `steps=null`;
- Node 22 job: completed/failure, `steps=null`.

Classification: `BLOCKED_REMOTE_CI_PRE_RUNNER`.

This is infrastructure evidence only. It is not a harness regression and not a chassis PASS/FAIL.

## Admission state after audit

- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`; formal cleanup support remains CLOSED.
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`; formal cleanup support remains CLOSED.
- Restate lifecycle: not yet implemented for formal admission.
- Trigger.dev: formal lifecycle not qualified; managed-controller T7 worker SIGKILL gap remains.
- Pilot records cannot be promoted to formal benchmark through ledger append or direct benchmark eligibility while lifecycle provenance is unverified.

## Next runtime gate

When runner execution becomes available:

1. execute lifecycle tests;
2. obtain at least one isolated real runtime pre-run + post-run cleanup receipt for Temporal and DBOS;
3. verify all observed process identities/resources are cleaned;
4. only then set the corresponding cleanup-support booleans true and lifecycle status to `RUNTIME_VERIFIED`;
5. rerun targeted Temporal T7/T8/T11/T16 qualification;
6. do not start the full formal repetition plan until these gates pass.
