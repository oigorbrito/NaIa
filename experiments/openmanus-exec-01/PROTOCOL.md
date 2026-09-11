# OpenManus EXEC-01 protocol

## Purpose

Evaluate whether OpenManus can replace the NaIA execution chassis without changing NaIA core semantics.

## Baseline

- NaIA branch: `product/mvp-foundation-v1`
- Baseline commit: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- Baseline test command: `npm test`
- Required baseline result: 18/18 PASS

## Hypothesis

OpenManus can execute a tool selected by NaIA using an external adapter/sidecar while preserving all current NaIA invariants.

## Architectural constraint

The following files must remain semantically unchanged:

- `src/product/service.mjs`
- `src/product/domain.mjs`
- `src/product/policy.mjs`

OpenManus upstream source files must not be modified.

## Contract

NaIA provides a step containing an already selected tool and arguments. The candidate runtime must not re-plan the action.

Request:

```json
{
  "tool": "text.uppercase",
  "input": { "text": "hello naia" }
}
```

Expected normalized response:

```json
{
  "ok": true,
  "output": {
    "tool": "text.uppercase",
    "result": { "text": "HELLO NAIA" }
  }
}
```

## Candidate tests

- EXEC-01: deterministic read-only tool execution
- EXEC-02: unknown tool fails closed
- EXEC-03: transient failure is normalized as retryable
- EXEC-04: permanent failure is normalized as non-retryable
- EXEC-05: write action is not sent to runtime before NaIA approval
- EXEC-06: timeout or cancellation never becomes success
- SEC-01: prompt-like content is treated as data and cannot trigger an additional tool

## Acceptance gates

A candidate is accepted only when all gates pass:

1. Baseline: 18/18 existing NaIA tests PASS.
2. Contract: 6/6 execution contract tests PASS.
3. Security: zero unauthorized side effects.
4. Core changes: zero semantic changes in service/domain/policy.
5. Upstream changes: zero OpenManus source modifications.
6. Reproduction: at least two successful clean-environment runs.

## Measurements

Record for every run:

- NaIA commit SHA
- OpenManus commit SHA
- OS and runtime versions
- adapter files and LOC
- NaIA core files changed
- upstream files changed
- install wall time
- test wall time
- execution latency p50/p95
- peak memory
- baseline tests passed
- candidate tests passed
- reproduction attempts/successes
- security failures

## Result vocabulary

Use only:

- PASS
- FAIL
- NOT_EXECUTED
- BLOCKED_EXTERNAL

Do not claim `CANDIDATE_ACCEPTED` until every acceptance gate is PASS.
