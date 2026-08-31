# Temporal T11 / T12 structural evidence — 2026-08-31

Status: IMPLEMENTED_NOT_RUNTIME_EXECUTED

Decision state remains:

- CHASSIS_WINNER = NOT_SELECTED
- BENCHMARK_TO_BEAT = NOT_SELECTED

This note records harness implementation evidence only. It is not a candidate PASS and does not fill any formal repetition in the preregistered 2400-record ledger.

## T11 — cancel / crash / retry race

Implemented files:

- `research/chassis/adapters/temporal-ts/t11-workflow.mjs`
- `research/chassis/adapters/temporal-ts/t11-activities.mjs`
- `research/chassis/adapters/temporal-ts/t11-worker-process.mjs`
- `research/chassis/adapters/temporal-ts/t11-driver.mjs`
- generalized `research/chassis/harness/t11-run-hook.mjs`

The intended causal schedule is:

1. Temporal Workflow reaches a query-visible pre-cancel checkpoint.
2. Client submits Workflow cancellation.
3. Driver waits until `WorkflowExecutionCancelRequested` is present in Temporal history; this is the durable cancellation authority boundary used by the experiment.
4. Worker A is SIGKILLed.
5. Worker B starts on the same task queue and objective identity.
6. Formal evidence requires a post-cancel `WorkflowTaskCompleted` whose native worker identity is Worker B. If Worker A processed cancellation before the crash, `recovery.attempted=false`; the formal executor therefore cannot report the mutant as injected and the record must be INCONCLUSIVE rather than candidate FAIL.
7. Workflow must reach native `CANCELLED` state and `WorkflowExecutionCanceled` history.
8. The neutral external oracle must retain `applyCount=0` for the protected operation.

This explicitly distinguishes a submitted cancel request from persisted cancel authority and distinguishes merely starting Worker B from proving that B handled recovery.

## T12 — stale completion after new authority commit

Implemented file:

- `research/chassis/adapters/temporal-ts/t12-driver.mjs`
- generalized `research/chassis/harness/t12-run-hook.mjs`

The driver reuses the already-versioned Temporal asynchronous-activity worker/workflow primitives from the T5 harness but applies the T12 schedule instead of the T5 live-race schedule:

1. Worker A obtains Activity attempt 1 and preserves its task token.
2. A stops polling while remaining able to submit its preserved completion.
3. Worker B obtains Activity attempt 2 for the same objective.
4. B completes attempt 2 and the Workflow reaches `WAITING_FINAL_RELEASE`, proving the new completion is authoritative before the stale submission.
5. A submits attempt 1 using the original native Temporal task token.
6. Final Workflow state/result is inspected after the stale submission.

T12 PASS later requires the stale completion to be explicitly rejected or independently proven non-authoritative and the final result to remain from the new authority.

## Upstream API/source basis audited

Pinned Temporal TypeScript SDK `v1.23.0` exposes:

- `WorkflowHandle.cancel()`;
- `WorkflowHandle.describe()`;
- `WorkflowHandle.fetchHistory()`;
- workflow execution status as `{ code, name }`, including `CANCELLED`;
- async Activity completion by task token through the client API.

Pinned Temporal server `v1.31.2` rejects Activity completion when the activity task token no longer identifies a running/current activity, which is the native stale-completion boundary used by T5/T12.

Source audit is implementation support, not runtime proof.

## Formal governance impact

`FORMAL_EXECUTOR_SUPPORT` now declares Temporal TypeScript for all six critical mutants: T5, T7, T8, T11, T12 and T16. DBOS TypeScript was already structurally declared for all six.

Benchmark execution readiness remains CLOSED because Restate still lacks T5/T11/T12/T16 formal executors and Trigger.dev still lacks T5/T7/T11/T12/T16 coverage for its managed-controller/worker boundary.

All new Temporal T11/T12 files are included in aggregate formal harness provenance.

## Execution boundary

B001 remains the candidate-runtime blocker. No Temporal T11 or T12 candidate run was executed in this environment. No PASS/FAIL candidate verdict is claimed by this document.
