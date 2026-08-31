# Chassis Harness Discrimination Baseline — 2026-08-31

Status: LOCAL PASS / CANDIDATE-INDEPENDENT

## Purpose

Prove that the NaIa chassis harness is capable of distinguishing a recovery-safe adapter from a deliberately defective duplicate-effect mutant before any finalist is judged with it.

This is a meta-test of the harness, not a Temporal, DBOS, Restate or Trigger.dev result.

## Environment

- Node: 22.16.0
- npm: 10.9.2
- Test runner: Node built-in `node:test`
- External dependencies: none

## Source identity

Locally executed content was checked against the GitHub branch blobs.

| File | Git blob SHA |
|---|---|
| `research/chassis/harness/fixtures/restart-adapter-control.mjs` | `3828eb4c094a0126c2258a4915b27359446bd32b` |
| `research/chassis/harness/restart-controls.test.mjs` | `18832b97da10fe4b423f27045413c6cb7a6e2f3e` |

The local Git blob hashes matched the committed branch blobs exactly.

## Control design

### Positive control

- Objective identity remains stable across attempts.
- External operation identity is derived from the objective and semantic step, not the worker attempt.
- Attempt 1 reaches the external oracle.
- The oracle applies the effect and deliberately drops the response.
- The harness observes `external_request_applied_or_ambiguous` and kills the adapter process with `SIGKILL`.
- Attempt 2 restarts the adapter and reuses the same external operation id.
- Expected oracle state: `requestCount=2`, `applyCount=1`.

### Negative control / mutant

The mutant changes the external operation id by including the process attempt number.

After the same response-loss and `SIGKILL` sequence, attempt 2 uses a different external operation id.

Expected invariant violation: total external applied effects = 2.

## Command and result

The isolated discrimination suite executed locally:

```text
tests = 2
pass = 2
fail = 0
```

Observed properties:

```text
POSITIVE_CONTROL_RESTART = PASS
POSITIVE_CONTROL_REQUESTS = 2
POSITIVE_CONTROL_APPLIED_EFFECTS = 1

NEGATIVE_CONTROL_MUTANT_DETECTED = PASS
NEGATIVE_CONTROL_APPLIED_EFFECTS = 2
HARNESS_FALSE_ACCEPT = NO
```

## Interpretation

The harness is not merely demonstrating a successful path. Under the same oracle and process-kill mechanism it distinguishes stable semantic operation identity from attempt-scoped identity that duplicates an irreversible external effect.

`HARNESS_DISCRIMINATING_POWER_T7_T8_T15 = PASS_AT_CURRENT_LAB_LEVEL`

This still does not establish candidate-engine behavior. Finalist adapters must be wired without changing the oracle or acceptance invariant.
