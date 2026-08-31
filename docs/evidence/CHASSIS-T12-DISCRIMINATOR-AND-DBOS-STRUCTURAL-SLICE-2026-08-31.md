# Chassis T12 discriminator and DBOS structural slice — 2026-08-31

Status: PARTIAL_EXECUTED_CONTROL / DBOS_RUNTIME_NOT_EXECUTED

## Scope

This evidence record covers two distinct claims:

1. the neutral T12 stale-completion discriminator and formal bridge can distinguish a fenced outcome from a stale overwrite under a deterministic schedule;
2. a DBOS TypeScript T12 candidate driver is structurally implemented against the pinned adapter/runtime model, but remains unexecuted because B001 prevents the candidate runtime from being installed/bootstrapped here.

It does **not** record DBOS T12 PASS or FAIL.

## T12 scientific boundary

T12 is `stale_completion_after_new_owner`. The stale completion is preserved, authority advances, the newer authority commits, and only then is the old completion submitted. This is intentionally distinct from T5, where the stale worker challenges the newer owner during the live ownership window before the newer owner completes.

The contract is versioned at `research/chassis/T12-STALE-COMPLETION-CONTRACT-V1.md`.

## Locally executed neutral discriminator subset

Runtime: Node v22.16.0.

The three core T12 files were reconstructed locally and their Git blob identities matched the current branch blobs exactly:

- `t12-stale-completion-control.mjs` -> `11ebf3a3d7377a0a8be5a7c49b1db509be421f1c`
- `t12-evaluator.mjs` -> `564ec9e4dae109f845cba84037a95d4ba994367a`
- `t12-record-bridge.mjs` -> `86e50ee06565207ea3ad8ae871c0726201c915b9`

A local smoke harness executed two assertions:

- 100 safe and 100 unsafe deterministic repetitions: every safe evidence object evaluated PASS and every unsafe stale-overwrite evidence object evaluated FAIL;
- deleting the required ordering proof (`staleCompletion.attemptedAfterNewCommit=false`) caused the formal bridge to keep `fault.injected=false`.

Result: 2 tests passed, 0 failed.

This validates the discriminator/evaluator/bridge semantics. The versioned `t12-*.test.mjs` files themselves were not byte-exact reexecuted in this environment because direct raw GitHub download was blocked by DNS. Therefore the correct status is `T12_NEUTRAL_DISCRIMINATOR_SUBSET = EXECUTED_PASS`, not `CURRENT_FULL_SUITE = PASS`.

## DBOS structural support

Pinned profile remains DBOS TypeScript `dbos-ts-v4.27`, npm artifact `@dbos-inc/dbos-sdk=4.27.6`, PostgreSQL required.

Upstream DBOS source provides the mechanism needed for a T12 challenge:

- terminal workflow output recording is conditional and reports whether the write landed;
- the source explicitly states that a refused outcome can mean the row is already terminal or has been handed to another execution, after which the executor adopts the recorded outcome rather than silently overwriting it;
- recovery/queue state includes `executor_id`, application version, workflow status and recovery attempt state, providing native durable authority observations.

The NaIa DBOS T12 driver reuses the already-versioned two-executor DBOS worker boundary, but changes the schedule from T5:

1. worker A starts and holds the old workflow completion;
2. worker B resumes the same workflow identity and becomes the newer executor authority;
3. worker B is released first and its result must become durable SUCCESS;
4. only after that durable commit is observed, worker A is released;
5. the driver accepts either an explicit stale-outcome rejection or adoption of B's already-recorded result, but only when final durable status still belongs to B;
6. final status is inspected after A's late completion challenge.

Files:

- `research/chassis/adapters/dbos-ts/t12-driver.mjs`
- `research/chassis/harness/t12-run-hook.mjs`
- `research/chassis/harness/t12-record-bridge.mjs`
- `research/chassis/harness/formal-executor-support.mjs`

The executor support matrix now declares T12 only for DBOS TypeScript/local-process. Temporal, Restate and Trigger.dev T12 remain structurally unsupported by the formal executor and therefore keep the benchmark execution readiness gate closed.

## Blockers and verdict boundary

`B001 = LOCAL_RUNTIME_DEPENDENCY_INSTALL_UNAVAILABLE` remains active. The DBOS T12 driver has not run against PostgreSQL and the exact npm artifact in this environment.

Consequently:

- `T12_NEUTRAL_DISCRIMINATOR_SUBSET = EXECUTED_PASS`
- `DBOS_T12_EXECUTOR = IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- `DBOS_T12_CANDIDATE_VERDICT = NOT_EXECUTED`
- `CURRENT_FULL_SUITE = NOT_EXECUTED_AFTER_T12_CHANGES`
- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
