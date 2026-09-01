# CHASSIS — Restate T11 structural slice — 2026-09-01

Status: IMPLEMENTED_NOT_RUNTIME_VERIFIED
Candidate: Restate server 1.7.8 / TypeScript SDK 1.16.9
Mutant: T11 `cancel_crash_retry_race`
Scope: local controlled fault-injection harness only

## Purpose

Close the remaining Restate executor gap for the critical T11 invariant `cancellation_blocks_future_unauthorized_progress` without treating an API acknowledgement as durable cancellation proof.

## Upstream basis

Restate documents graceful cancellation through `PATCH /invocations/{invocation_id}/cancel`. The invocation is terminated while progress is persisted. Restate also documents cancellation as non-blocking and states that the SDK surfaces cancellation as a cancellation-specific `CancelledError` (a `TerminalError` subclass) at the next awaited Restate context action. Workflow executions are keyed by workflow ID and cannot be submitted twice under the same ID.

This slice therefore requires two candidate-native observations before injecting `SIGKILL` into the old service process:

1. the old TypeScript handler observes Restate `CancelledError` while awaiting a durable Restate sleep;
2. the Restate ingress exposes the cancellation failure status `409` rather than the `470 not ready` state.

The first proves that cancellation reached the SDK execution boundary. The second proves that the server-side durable workflow authority has moved to terminal state. Only after both barriers does the harness kill the old service process.

## Recovery challenge

A distinct Restate service process is then started and registered as a distinct deployment. The driver attempts candidate-native resume for the original invocation using `deployment=latest`.

If Restate refuses to resume the already-terminal cancelled invocation, the result is admissible as `blockedBeforeProtectedOperation` only when:

- the terminal workflow output remains observable after restart;
- the neutral external oracle records zero accepted protected operations;
- the original objective/workflow identity is preserved;
- the old and recovery service/deployment identities are concrete and distinct.

## Implementation

- `research/chassis/adapters/restate-ts/t11-workflow.mjs`
- `research/chassis/adapters/restate-ts/t11-service-process.mjs`
- `research/chassis/adapters/restate-ts/t11-driver.mjs`
- wired through `research/chassis/harness/t11-run-hook.mjs`
- admitted by `research/chassis/harness/formal-executor-support.mjs`
- included in formal harness provenance

No cancellation flag, fencing store, or provider-side suppression was added to make the candidate pass.

## Current evidence state

Structural implementation: PRESENT
Static syntax check: PASS locally for the three new `.mjs` files
Candidate runtime execution: NOT YET VERIFIED
Expected runtime blocker if prerequisites remain unavailable: `RESTATE_T11_RUNTIME_PREREQUISITE_UNAVAILABLE`

This record does not declare T11 PASS for Restate. A formal PASS requires execution against the pinned Restate server/SDK runtime and normal cleanup/provenance gates.
