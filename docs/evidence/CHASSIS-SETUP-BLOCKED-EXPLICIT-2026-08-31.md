# Explicit Setup-Blocked Executor Evidence — 2026-08-31

Status: EXECUTED_PASS / FORMAL_SINGLE_FULL_SUITE_NOT_REEXECUTED

This evidence records a hardening of the formal experiment executor. When candidate setup returns `BLOCKED_SETUP`, the candidate run hook is not executed and the generated run section now records `rawObservations.setupBlocked=true` with `fault.injected=false`.

## Exact production files reconstructed

The following current production files were reconstructed byte-for-byte locally and verified with `git hash-object` against the GitHub blobs:

- `research/chassis/harness/experiment-executor.mjs` — `7ff2adb0c98c383cc79d7d6fec2266f65a0cce5c`
- `research/chassis/harness/experiment-protocol-validator.mjs` — `93903ecfe4221a9da9a32293b751ff51e3843e02`
- `research/chassis/harness/experiment-record-validator.mjs` — `79b53f0aaf7ad1dc5fbf920ebdd472a039b2df30`

Runtime: Node `v22.16.0`.

## Executed check

A DBOS T16 formal-spec-shaped execution was passed directly through the exact current `executeExperiment` with:

- experimentId: `dbos-typescript-t16-001`
- candidate: `DBOS TypeScript`
- mutant: `T16`
- repetition: `1`
- randomSeed: `2160001`
- setup: `BLOCKED_SETUP`
- blocker: `DEPENDENCY_NOT_INSTALLED+REQUIRED_ENV_MISSING`

The candidate run hook was instrumented to fail if called.

Observed result:

```text
valid = true
verdict = BLOCKED
runCalled = false
run.fault.intended = T16
run.fault.injected = false
run.rawObservations.setupBlocked = true
cleanup = NOT_APPLICABLE
```

This is executor/record-semantics evidence. It is not a DBOS candidate T16 runtime result.

## Versioned entrypoint regression

`research/chassis/harness/formal-single-run.test.mjs` now includes a synthetic DBOS T16 case requiring the same BLOCKED semantics for a missing SDK/environment before the dedicated T16 driver can execute.

That complete test file is versioned but the full current `formal-single-run` source graph has not been independently reconstructed and reexecuted in this environment. Therefore:

- `SETUP_BLOCKED_EXECUTOR_CORE = EXECUTED_PASS`
- `DBOS_T16_FORMAL_SINGLE_BLOCKED_REGRESSION = VERSIONED_NOT_REEXECUTED_AS_FULL_SUITE`
- `DBOS_T16_CANDIDATE_RUNTIME = NOT_EXECUTED`

No BLOCKED result may be promoted to candidate PASS/FAIL, and no blocked record makes a critical mutant benchmark-eligible.
