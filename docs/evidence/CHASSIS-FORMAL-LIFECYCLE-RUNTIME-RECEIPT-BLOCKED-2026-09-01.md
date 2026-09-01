# Chassis Formal Lifecycle Runtime Receipt — blocked execution — 2026-09-01

## Scope

CHASSIS_ONLY.

The attempted run is a local-test-harness qualification of the NaIa repository's own Temporal and DBOS runtime lifecycles. It is controlled fault injection against experiment-owned worker processes and experiment-owned durable state only. There is no third-party target, credential bypass, or real-world service disruption.

## Purpose

Obtain the first independent runtime receipt for the already implemented formal runtime lifecycle of:

- Temporal TypeScript, T5 repetition 1;
- DBOS TypeScript, T5 repetition 1.

T5/r1 was selected because it is the first relevant preregistered cell, not because of its previously observed semantic outcome. Candidate semantic PASS/FAIL is explicitly independent from lifecycle-cleanup verification.

## Frozen qualification gate

A lifecycle receipt is insufficient unless the record proves all of the following:

- schema-valid experiment record;
- T5 repetition 1;
- READY setup with complete PASS pre-run cleanup receipt;
- intended fault actually injected against a concrete target while durable authority remains alive;
- one or more concrete worker PIDs observed;
- zero observed worker PIDs alive after cleanup;
- post-run cleanup status PASS with all four cleanup dimensions true;
- candidate-specific durable-state cleanup proof;
- no benchmark promotion and no ledger append from this qualification run.

The gate is implemented in `research/chassis/harness/formal-lifecycle-runtime-receipt-validator.mjs` and covered structurally by its test file. DBOS lifecycle structural coverage was added in `research/chassis/harness/formal-dbos-lifecycle.test.mjs`.

## Targeted workflow

Workflow: `.github/workflows/research-chassis-formal-lifecycle-runtime-receipt.yml`

Commit that introduced the workflow: `e3475365e1bd82b118f40eed0ff3631082fbdb2e`

GitHub Actions run: `33523858498`

Observed jobs:

- `99909576298` — `temporal-t5-r1-lifecycle-receipt` — conclusion `failure` — `steps=null`;
- `99909576671` — `dbos-t5-r1-lifecycle-receipt` — conclusion `failure` — `steps=null`.

Workflow artifacts returned by the GitHub Actions API: empty list.

Because both jobs have no executed steps and emitted no artifacts, checkout, dependency installation, candidate runtime setup, fault injection, evaluator execution, and lifecycle cleanup were never reached.

## Classification

`BLOCKED_REMOTE_CI_PRE_RUNNER`

This is not:

- Temporal PASS or FAIL;
- DBOS PASS or FAIL;
- lifecycle runtime verification;
- harness semantic failure;
- benchmark evidence;
- formal ledger evidence.

## Gate state after the blocked run

Temporal TypeScript:

- lifecycle implementation: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- `preRunCleanup=false`;
- `postRunCleanup=false`.

DBOS TypeScript:

- lifecycle implementation: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- `preRunCleanup=false`;
- `postRunCleanup=false`.

Global decision state remains:

- `BENCHMARK_TO_BEAT = NOT_SELECTED`;
- `CHASSIS_WINNER = NOT_SELECTED`.

## Next valid action

Do not alter the lifecycle support booleans while this blocker persists. The same preregistered T5/r1 receipt workflow may be rerun when an execution environment reaches the runner. Only a runtime record passing the predeclared receipt validator may enter a separate lifecycle-promotion review. That review still must not append the qualification record to the formal benchmark ledger.
