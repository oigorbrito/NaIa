# Chassis T15 Provider Discrimination Evidence — 2026-08-31

Decision state remains:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`

## Purpose

Validate that the common external oracle can discriminate reconciliation from blind retry when the external provider is deliberately non-idempotent. This is a harness qualification result, not candidate runtime evidence and not a substitute for any benchmark-critical mutant repetition.

## Executed artifacts

Execution environment:

- Node: `v22.16.0`
- execution mode: independent local reconstruction from versioned GitHub blobs

Versioned source identity verified before execution:

- `research/chassis/harness/external-oracle.mjs`
  - Git blob SHA: `118fdd5a0e2df4733110f42da41f38c607a71b8b`
  - reconstructed Git blob SHA: `118fdd5a0e2df4733110f42da41f38c607a71b8b`
- `research/chassis/harness/external-oracle-t15.test.mjs`
  - Git blob SHA: `0c4f7cf0bc914b6c7c0fa53ee014d8955de0d05c`
  - reconstructed Git blob SHA: `0c4f7cf0bc914b6c7c0fa53ee014d8955de0d05c`

Therefore the executed test and oracle bytes matched the versioned blobs exactly.

## Command

```bash
node --test research/chassis/harness/external-oracle-t15.test.mjs
```

The command above describes the repository-relative equivalent of the independently reconstructed execution.

## Result

```text
TESTS = 3
PASS = 3
FAIL = 0
```

Observed properties:

1. Safe reconciliation after one lost response:
   - provider mode: `NON_IDEMPOTENT`
   - `requestCount = 1`
   - `applyCount = 1`
   - `responseLossCount = 1`

2. Blind retry after one lost response:
   - provider mode: `NON_IDEMPOTENT`
   - `requestCount = 2`
   - `applyCount = 2`
   - `responseLossCount = 1`

3. Provider mode drift:
   - initial operation used `IDEMPOTENT_BY_OPERATION_ID`
   - attempt to switch the same semantic operation to non-idempotent mode returned HTTP `409`
   - stored operation remained at `applyCount = 1`

## Interpretation

The T15 oracle is discriminating the intended property: stable semantic `operationId` alone does not create exactly-once external effects when the provider itself is non-idempotent. Reconciliation can avoid a second apply; blind retry produces a duplicate apply.

This result validates the neutral oracle behavior only. It does not establish PASS or FAIL for Temporal, DBOS, Restate, or Trigger.dev.
