# Temporal T16 Structural Slice Evidence — 2026-08-31

Status: IMPLEMENTED_NOT_RUNTIME_VERIFIED

This note records implementation and independently executed profile-discriminator evidence for the NaIA T16 (`identity_or_config_changes_before_recovery`) Temporal TypeScript slice. It is not a candidate T16 PASS and is not benchmark evidence.

## Frozen candidate profile

- Candidate: Temporal TypeScript
- NaIA profile: `temporal-ts-restricted-v1`
- SDK packages: `@temporalio/activity/client/worker/workflow = 1.23.0`
- Temporal CLI: `v1.7.3`
- effective server profile: `v1.31.2`
- mode: `local-process`
- runtime status in current environment: `BLOCKED_B001`

## Upstream mechanism audited

Temporal TypeScript SDK v1.23.0 exposes `WorkflowClient.start(workflowTypeOrFunc: string | Workflow, ...)` and public `WorkflowHandle.fetchHistory()`.

The upstream v1.23.0 nondeterminism test deliberately produces incompatible replay and polls workflow history for a native `WorkflowTaskFailed` event whose failure message contains `Nondeterminism`. The test documents the default behavior: incompatible replay fails the Workflow Task while the workflow execution remains available for compatible code to continue it.

This upstream source/test is mechanism evidence, not NaIA candidate runtime evidence.

## NaIA T16 driver design

The declared semantic dimension is `workflowImplementationSha256`.

Profile A and profile B preserve:

- workflow type `t16VersionedWorkflow`;
- workflow ID;
- namespace;
- task queue;
- release signal identity `naia-t16-release`.

They intentionally differ in one durable workflow command:

- profile A executes `await sleep('1ms')`, producing timer history, then waits for the release signal;
- profile B omits the timer and waits directly for the same signal.

Deterministic sequence:

1. worker A starts profile A and the workflow;
2. the driver waits until history contains a fired timer followed by a completed Workflow Task;
3. worker A is SIGKILLed while Temporal server/history remains external;
4. worker B starts profile B on the same task queue and workflow type with `maxCachedWorkflows=0`;
5. the driver polls `fetchHistory()` and requires an actual `WorkflowTaskFailed` event containing `Nondeterminism`;
6. only that native event can classify the disposition as `REJECTED_INCOMPATIBLE`;
7. worker B stops;
8. worker C starts profile A, signals the original workflow and must receive a result from semantic profile A;
9. final workflow state is independently described.

Timeout, lack of progress, or absence of a B result is not enough to classify rejection. Without the native nondeterminism history event the disposition remains non-PASS-compatible.

## Versioned implementation

- `research/chassis/adapters/temporal-ts/t16-workflow-a.mjs`
- `research/chassis/adapters/temporal-ts/t16-workflow-b.mjs`
- `research/chassis/adapters/temporal-ts/t16-worker-process.mjs`
- `research/chassis/adapters/temporal-ts/t16-driver.mjs`
- `research/chassis/harness/t16-temporal-run-hook.mjs`
- common formal T16 evaluator/record bridge

`FORMAL_EXECUTOR_SUPPORT.T16` now permits Temporal TypeScript and DBOS TypeScript in local-process mode. The common formal run hook dispatches Temporal T16 to the dedicated Temporal hook. These components are included in aggregate formal harness provenance.

## Independently executed profile discriminator

Runtime: Node `v22.16.0`.

The exact current files were reconstructed locally and verified with `git hash-object`:

- `t16-workflow-a.mjs` = `1eadd0453e8ed34d062413a68ec97687e2cbbe79`
- `t16-workflow-b.mjs` = `9d0467e53657357e0efbe83ca91a157178c5e6fe`
- `temporal-t16-profile.test.mjs` = `1a4c72d8f5135db7d5b2b43fed043e7dcd040f31`

Executed result:

```text
Temporal T16 profiles preserve workflow/signal identity while mutating the durable timer command
PASS 1/1
FAIL 0
```

This proves the profile discriminator itself: same workflow/signal identity, distinct source hashes, timer command present only in A. It does not prove Temporal runtime rejection or recovery.

## Runtime boundary

The candidate experiment has not executed against the pinned Temporal SDK/server profile because B001 remains active. Therefore:

- `TEMPORAL_T16_EXECUTOR = IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- `TEMPORAL_T16_PROFILE_DISCRIMINATOR = EXECUTED_PASS_1_OF_1`
- `TEMPORAL_T16_CANDIDATE_RUNTIME = NOT_EXECUTED`
- `TEMPORAL_T16_PASS = NOT_CLAIMED`

The formal cleanup gate also remains fail-closed. A future READY execution cannot become benchmark PASS without independently proven cleanup.

## Readiness impact

Temporal now has structural formal executor coverage for T5, T7, T8 and T16. T11 and T12 remain executor gaps. DBOS has structural executor coverage for all six critical mutants. Restate and Trigger.dev retain additional gaps, including Trigger T7 actual-worker kill boundary B003.

Global benchmark execution readiness therefore remains closed.

## Decision state

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `BENCHMARK_LEDGER_STARTED = NO`
