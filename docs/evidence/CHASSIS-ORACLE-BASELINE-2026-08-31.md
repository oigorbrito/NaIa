# Chassis External Oracle Baseline — 2026-08-31

Status: LOCAL PASS / REMOTE CI NOT YET OBSERVED

## Purpose

Validate the neutral external-effect oracle before using it to judge any chassis candidate.

This is not a Temporal, DBOS, Restate or Trigger.dev result.

## Environment

- Node: 22.16.0
- npm: 10.9.2
- Test runner: Node built-in `node:test`
- External dependencies: none

## Source identity

The locally executed files were compared using Git blob SHA against the files committed on branch `research/qualified-chassis-gate-v1`.

| File | Git blob SHA |
|---|---|
| `research/chassis/harness/external-oracle.mjs` | `c1d85b2c3646d5cdbc2d6a4f8f109bffe3dbfdc2` |
| `research/chassis/harness/external-oracle.test.mjs` | `154da55c584de3aefcb69071b0933437fad2c322` |
| `package.json` | `2c43ef42a160ea8ce755e2958ed444f0981ec248` |

The hashes matched between the local executed content and the GitHub branch content.

## Command

```text
npm test
```

Resolved test command:

```text
node --test research/chassis/harness/*.test.mjs
```

## Results

```text
tests = 6
pass = 6
fail = 0
cancelled = 0
skipped = 0
todo = 0
```

Tested properties:

1. repeated request with same operation id increments request count but applies effect once;
2. distinct operation ids produce distinct effects;
3. response can be lost after effect application and later reconciliation proves the effect happened;
4. missing operation identity fails closed with HTTP 400;
5. 100 consecutive response-loss-after-apply cycles reconcile with `requestCount=2` and `applyCount=1` for every operation;
6. 25 concurrent requests sharing one operation id result in 25 requests and one applied effect.

## Interpretation

`ORACLE_STABLE_OPERATION_ID = PASS`

`ORACLE_RESPONSE_LOSS_AFTER_APPLY = PASS`

`ORACLE_100X_AMBIGUOUS_RECONCILIATION = PASS`

`ORACLE_CONCURRENT_DUPLICATE_APPLY_GUARD = PASS`

`ORACLE_MISSING_ID_FAIL_CLOSED = PASS`

This establishes the external oracle as usable for candidate tests T7, T8 and T15 at the current laboratory level.

It does not prove candidate-engine behavior and does not establish distributed exactly-once semantics.

## Remote CI

At the time of this record, the GitHub Actions query for branch `research/qualified-chassis-gate-v1` returned zero workflow runs.

Therefore:

`REMOTE_CI = NOT_STARTED_OR_NOT_TRIGGERED`

No remote PASS is inferred.

## Next step

Add a candidate adapter contract and process-level crash controller, then connect the first finalist without changing the oracle semantics.
