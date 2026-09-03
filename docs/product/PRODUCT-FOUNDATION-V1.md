# NaIA Product Foundation V1

Date: 2026-09-03
Branch: `product/mvp-foundation-v1`

## Purpose

Start executable NaIA product work without waiting for the still-open chassis benchmark. This does not select a chassis winner and does not weaken the research gate for any future `BENCHMARK_TO_BEAT` or `CHASSIS_WINNER` claim.

## Implemented product slice

`objective -> plan -> execution port -> evidence -> persisted state`

Current product components:

- objective domain and lifecycle status;
- deterministic initial plan with UNDERSTAND / EXECUTE / VERIFY steps;
- replaceable objective, plan, evidence and execution ports;
- in-memory adapters for tests;
- file-backed objective and plan stores;
- append-only JSONL evidence store;
- atomic JSON writes for mutable local state;
- resumable execution that skips already completed steps;
- persistent CLI commands: `pursue`, `resume`, `show`;
- tests for success, fail-visible behavior, resume semantics and cross-instance persistence.

## Runtime boundary

The current file-backed execution adapter is a local placeholder. It is deliberately not a durable-execution chassis and must not be interpreted as such. The product domain depends on the `execution.run(...)` port rather than Temporal, DBOS, Restate or Trigger.dev APIs.

This boundary is intended to let chassis research later provide an adapter without rewriting objective, plan or evidence semantics.

## Local state

Default local state directory: `.naia/`

Files:

- `.naia/objectives.json`
- `.naia/plans.json`
- `.naia/evidence.jsonl`

The directory is Git-ignored.

## Commands

```bash
npm test
npm run start:product -- pursue "my objective"
npm run start:product -- show <objectiveId>
npm run start:product -- resume <objectiveId>
```

## Foundation exit state

`PRODUCT_DOMAIN = IMPLEMENTED`

`OBJECTIVE_PLAN_EXECUTION_EVIDENCE_SLICE = IMPLEMENTED`

`LOCAL_PERSISTENCE = IMPLEMENTED`

`RESUME_SEMANTICS = IMPLEMENTED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`USER_INTERFACE = CLI_ONLY`

`PRODUCT_FOUNDATION_V1 = IMPLEMENTED_NEEDS_RUNTIME_VALIDATION`

## Next product block

Build the first useful capability path on top of these ports: user intent input, actionable plan/tool selection, explicit authorization boundary where needed, tool invocation, evidence rendering and objective history. Keep infrastructure replaceable and keep chassis winner selection separate.
