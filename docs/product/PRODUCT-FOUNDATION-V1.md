# NaIA Product Foundation V1

Date: 2026-09-03
Branch: `product/mvp-foundation-v1`

## Purpose

Start executable NaIA product work without waiting for the still-open chassis benchmark. This does not select a chassis winner and does not weaken the research gate for any future `BENCHMARK_TO_BEAT` or `CHASSIS_WINNER` claim.

## Implemented product slice

`objective -> plan -> execution port -> evidence -> persisted state`

Current product components:

- objective domain and lifecycle status;
- replaceable objective, plan, evidence, policy and execution ports;
- in-memory adapters for tests;
- file-backed objective and plan stores;
- append-only JSONL evidence store;
- atomic JSON writes for mutable local state;
- resumable execution that skips already completed steps;
- persistent CLI commands;
- focused product CI.

The foundation has now been exercised by the completed [First Useful Capability V1](FIRST-USEFUL-CAPABILITY-V1.md), which adds actionable intent planning, tool selection, explicit authorization for side effects, real local tool invocation and objective history.

## Runtime boundary

The product domain depends on replaceable ports rather than Temporal, DBOS, Restate or Trigger.dev APIs. No durable-execution chassis is selected here.

This boundary lets chassis research later provide an adapter without rewriting objective, plan, policy or evidence semantics.

## Local state

Default local state directory: `.naia/`

Files:

- `.naia/objectives.json`
- `.naia/plans.json`
- `.naia/evidence.jsonl`
- `.naia/workspace/notes/` for approved local note writes

The directory is Git-ignored.

## Foundation exit state

`PRODUCT_DOMAIN = IMPLEMENTED`

`OBJECTIVE_PLAN_EXECUTION_EVIDENCE_SLICE = IMPLEMENTED`

`LOCAL_PERSISTENCE = IMPLEMENTED`

`RESUME_SEMANTICS = IMPLEMENTED`

`PORTABLE_POLICY_AND_EXECUTION_BOUNDARY = IMPLEMENTED`

`FIRST_USEFUL_CAPABILITY_V1 = COMPLETE`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`USER_INTERFACE = CLI`

`PRODUCT_FOUNDATION_V1 = COMPLETE`

## Next product block

Build the extensible capability layer: richer planner contracts, external adapters, scoped policy rules, improved presentation, and eventual durable-execution integration behind the existing ports. Keep chassis winner selection separate.
