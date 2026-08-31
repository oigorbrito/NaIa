# Chassis T16 Discriminator Evidence — 2026-08-31

Status: EXECUTED_CONTROL_EVIDENCE / NOT_CANDIDATE_EVIDENCE

## Scope

This evidence validates the neutral T16 semantic-compatibility discriminator and its formal record bridge. It does not execute T16 against Temporal, DBOS, Restate, or Trigger.dev and cannot fill a preregistered candidate ledger slot.

## Exact repository identities

The following current branch files were reconstructed locally byte-for-byte and their computed Git blob SHA-1 values matched GitHub:

- `research/chassis/harness/t16-semantic-control.mjs` — `02e47ca9d3e67c33e08a67e33ff02667e0ac8ec8`
- `research/chassis/harness/t16-evaluator.mjs` — `37fd3330f723eee081e62ca56d75b1544f4fbc77`
- `research/chassis/harness/t16-evaluator.test.mjs` — `45b8b2935d65c4af5c76f9955ffe8d6034f06588`
- `research/chassis/harness/t16-record-bridge.mjs` — `b0614c9e8bf633bb666f1b9a43881cf3beae2efb`
- `research/chassis/harness/t16-record-bridge.test.mjs` — `7f40a6919f19ae3f1c7050de2366c8876c87d05a`

Runtime: Node `v22.16.0`.

## Executed tests

Command-equivalent subset:

```text
node --test t16-evaluator.test.mjs t16-record-bridge.test.mjs
```

Result:

```text
TESTS = 9
PASS = 9
FAIL = 0
SKIPPED = 0
```

The executed discriminator distinguishes:

- explicit incompatibility rejection => safe control PASS;
- explicit routing to compatible semantics => safe control PASS;
- explicit migration with concrete migration identity => safe control PASS;
- migration without migration identity => discriminator FAIL;
- silent semantic reinterpretation => discriminator FAIL;
- no actual before/after mutation => discriminator FAIL / fault not injected at bridge level;
- unknown compatibility disposition => discriminator FAIL.

The bridge preserves `rawObservations.semanticMutation` at the validator-visible location required for a future T16 candidate PASS record.

## Scientific boundary

`T16_DISCRIMINATOR = EXECUTED_PASS_9_OF_9` means only that the neutral control/evaluator/bridge is capable of distinguishing declared safe versus unsafe semantic-recovery outcomes for the tested synthetic cases.

It does not prove that any candidate exposes the required native compatibility evidence, rejects incompatible recovery, routes to compatible code, or performs an explicit migration. Candidate T16 remains `NOT_EXECUTED` until a candidate-specific executor induces a real semantic mutation and observes the native recovery disposition under the frozen protocol.

`CHASSIS_WINNER = NOT_SELECTED` and `BENCHMARK_TO_BEAT = NOT_SELECTED` remain unchanged.
