# CHASSIS — Temporal pilot reconciliation — 2026-09-01

## Scope

This record is limited to the NaIa chassis qualification harness. It is a pilot/reconciliation artifact, not formal benchmark-ledger evidence.

`formalLedger = false`

No chassis winner or benchmark-to-beat is selected by this record.

## Frozen Temporal runtime profile used by the completed pilot

- Candidate: Temporal TypeScript restricted profile
- SDK packages: `1.23.0`
- Node: `22.16.0`
- Temporal CLI: `1.8.1`
- Embedded Temporal server reported by the CLI: `1.31.2`
- Linux amd64 CLI asset SHA-256: `b94417b9a8760b30217f4b881dabce4b16a76a38b5e99e2eca3ce358b8030f06`
- Frozen npm lock SHA-256: `70577d13ae243d0f5b0f7f1c7933655af7ac8a238c0b2238c474bb055641235f`
- Persistence: isolated SQLite file per cell via Temporal `server start-dev --db-filename`
- Completed pilot commit: `971e9d3136fb5b31bccc2851ee02a2e25eec9fc6`
- Completed pilot workflow run: `33511756616`
- Matrix: critical mutants `T5,T7,T8,T11,T12,T16`, three repetitions each
- Cleanup: all 18 cells reported `cleanup_status=PASS`; worker processes, Temporal server and isolated SQLite store were removed after each cell
- Runtime lock: all 18 cells reported the same frozen lock SHA-256 above

## Directly usable pilot observations

### T5

All three repetitions produced `QUALIFICATION_PASS` under the frozen evaluator and cleanup contract.

Observed contract properties included distinct old/new Temporal activity task-token authority, attempted stale completion, stale completion rejected/non-authoritative, new authority remaining current, final result originating from the new authority, durable authority remaining available, and deterministic schedule observation.

Pilot classification: `PASS 3/3`.

### T12

All three repetitions produced `QUALIFICATION_PASS` under the frozen evaluator and cleanup contract.

The newer authority committed first, the held old completion was then submitted, the stale completion remained non-authoritative, and final durable meaning remained with the newer authority.

Pilot classification: `PASS 3/3`.

## Cells requiring reconciliation before they can be used as candidate findings

### T7 and T8 — adapter status defect, not candidate finding

The common runner observed the required candidate-native effects successfully:

- T7: crash injection occurred, resume reached completion, the expected external operation applied once, identity did not drift, no duplicate external effect was observed and no unexpected response loss occurred.
- T8: one response loss was observed, completion was recovered, the expected external operation applied once, identity did not drift and no duplicate external effect was observed.

However, the Temporal adapter implemented `status` only as a workflow query. Temporal rejects that query after the workflow is closed, so `status.parsed` was null and `finalStatusCompleted=false` in all T7/T8 repetitions. The common runner's measured predicate therefore returned FAIL even though the substantive recovery/effect checks passed.

This is classified as a harness/adapter defect. The T7/T8 pilot FAIL labels MUST NOT be treated as Temporal candidate FAILs.

Patch awaiting runtime recheck:

- `98b8e3fb5f6fb87ed2cfb6e6570d69da2e4f87ab` — normalize closed-workflow status using native `describe()` and emit common `state=COMPLETED` for a completed execution.

### T11 — scheduling race prevented equivalent recovery challenge in two repetitions

Pilot results:

- repetition 1: `QUALIFICATION_PASS`
- repetitions 2 and 3: frozen evaluator returned FAIL for `recoveryAttempted`, `postCancelBoundaryChallengedSafely` and `deterministicScheduleObserved`

In all three repetitions:

- cancellation was durably requested;
- the old worker was SIGKILLed after cancellation authority was observed;
- no protected external operation was accepted after cancellation;
- final durable state was `CANCELLED`;
- cleanup passed.

The difference was causal scheduling. In repetition 1, worker B completed the post-cancel Workflow Task and the history therefore proved recovery by B. In repetitions 2 and 3, the cancellation completed before B obtained that task, so the intended post-crash recovery challenge was not actually exercised. These two cells do not support a candidate semantic FAIL; they are schedule/fault-measurement incomplete cells.

Patch awaiting runtime recheck:

- `2ea7ea47f3b35a5e8c36c4b8cf4adb8219c994c3` — add a native worker polling barrier command.
- `ac99a625b11ce4b0c7b77210689771667315bed4` — stop old-worker polling before publishing cancellation, then observe durable cancellation, SIGKILL the old process and allow worker B to perform the recovery task. The frozen T11 evaluator is unchanged.

### T16 — incompatible implementation was not stimulated to replay

All three pilot cells were classified `INCONCLUSIVE_NO_RUNTIME_EVIDENCE`.

The driver created a durable execution under profile A and started incompatible profile B, but then waited for a `WorkflowTaskFailed` nondeterminism event without first causing a new Workflow Task. The history therefore remained idle and no replay attempt occurred before timeout.

This is an incomplete stimulus, not candidate PASS or FAIL.

The candidate profiles remain intentionally incompatible:

- profile A records a durable timer command before waiting for release;
- profile B omits that durable timer command.

Patch awaiting runtime recheck:

- `e6717004020f3f2aa52bce58df302c86cda009e2` — persist the native release signal while incompatible profile B is active. The signal creates the Workflow Task that forces B to replay A's history; the same durable signal is then available to compatible profile A after B is rejected. The frozen T16 evaluator is unchanged.

## Targeted recheck and external blocker

Targeted recheck workflow added at commit:

`70cd0cb32d0f5e55014e94588d70ac560a9d3f67`

Workflow run:

`33518842482`

Intended matrix:

`T7,T8,T11,T16 × 3 repetitions`

The targeted recheck did not execute any workflow step. All twelve matrix jobs terminated before step execution. An independent chassis harness run triggered from the same commit also failed/cancelled before step execution. No runtime evidence was produced by this recheck.

Classification:

`BLOCKED_REMOTE_CI_PRE_RUNNER`

This blocker MUST NOT be converted into candidate PASS, candidate FAIL, or an executed-patch claim.

## Current pilot comparison state

Temporal usable pilot evidence:

- T5: `PASS 3/3`
- T12: `PASS 3/3`
- T7: `RECHECK_REQUIRED_AFTER_ADAPTER_FIX`
- T8: `RECHECK_REQUIRED_AFTER_ADAPTER_FIX`
- T11: `RECHECK_REQUIRED_AFTER_SCHEDULE_FIX` (one prior valid PASS, two incomplete challenge cells)
- T16: `RECHECK_REQUIRED_AFTER_STIMULUS_FIX`

Previously reconciled DBOS pilot evidence under its separately frozen profile:

- T5: `FAIL 3/3`
- T7: `PASS 3/3`
- T8: `PASS 3/3`
- T11: `PASS 3/3`
- T12: `PASS 3/3`
- T16: `PASS 3/3`

The DBOS/Temporal T5 contrast is therefore a reproducible pilot signal (`DBOS FAIL 3/3` versus `Temporal PASS 3/3`) but is not sufficient by itself to select a chassis or benchmark-to-beat.

## Decision state

`BENCHMARK_TO_BEAT = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`

Next valid step: rerun only the targeted Temporal T7/T8/T11/T16 cells under the already frozen runtime profile when a runner can actually execute jobs. Do not rerun T5/T12 merely to compensate for the remote CI blocker.
