# DBOS T16 Structural Slice Evidence — 2026-08-31

Status: IMPLEMENTED_NOT_RUNTIME_VERIFIED

This note records implementation evidence for the NaIA T16 (`identity_or_config_changes_before_recovery`) DBOS TypeScript slice. It is not a candidate PASS and is not benchmark evidence.

## Frozen candidate profile

- Candidate: DBOS TypeScript
- NaIA profile: `dbos-ts-v4.27`
- Execution artifact: `@dbos-inc/dbos-sdk = 4.27.6`
- Reviewed upstream source family: `dbos-inc/dbos-transact-ts` tag `v4.27`
- Required durable authority: PostgreSQL
- Runtime status in the current environment: `BLOCKED_B001`

## Upstream mechanism audited

DBOS v4.27 exposes `applicationVersion` and `executorID` in runtime configuration. During executor initialization it calls pending-workflow recovery for its executor identity and passes the current application version to the system-database recovery query.

The upstream `tests/appversion.test.ts` recovery test demonstrates the intended discrimination: pending work recovers after restart with the same application/source version and is not recovered after application code/version changes. This is source/upstream-test evidence, not NaIA runtime evidence.

## NaIA T16 driver design

The candidate driver changes exactly one semantic dimension: `applicationVersion`.

Deterministic sequence:

1. Worker A starts with explicit version A and a stable executor identity.
2. The workflow completes a DBOS durable step checkpoint and emits the checkpoint observation only after `DBOS.runStep` returns.
3. Worker A is terminated with `SIGKILL`; PostgreSQL is not intentionally stopped.
4. Worker B starts with the same executor identity but explicit version B.
5. After `DBOS.launch()` completes its native recovery phase, the driver queries the same workflow identity and checks that version B did not recover the version-A workflow.
6. Worker B is stopped.
7. Worker C starts with the same executor identity and version A.
8. The driver requires the original workflow to be recovered under A, releases its deterministic gate, waits for completion, and inspects final native status.
9. Only the complete A -> B(non-recovery) -> A(recovery) sequence may classify the compatibility disposition as `ROUTED_TO_COMPATIBLE`.

The driver returns `UNKNOWN`, not PASS-compatible evidence, if this complete routing proof is absent.

## Versioned implementation

- `research/chassis/adapters/dbos-ts/t16-workflow.mjs`
- `research/chassis/adapters/dbos-ts/t16-worker-process.mjs`
- `research/chassis/adapters/dbos-ts/t16-driver.mjs`
- `research/chassis/harness/t16-run-hook.mjs`
- `research/chassis/harness/t16-record-bridge.mjs`
- `research/chassis/harness/t16-evaluator.mjs`

`FORMAL_EXECUTOR_SUPPORT.T16` now permits only `DBOS TypeScript` in `local-process` mode. The common formal run hook routes T16 to the dedicated driver. The complete DBOS T16 execution machinery is included in aggregate harness provenance.

## Local checks performed

Local Node version: `v22.16.0`.

The exact current contents of these two newly versioned files were reconstructed locally and parsed with `node --check`:

- `t16-workflow.mjs` — syntax PASS; GitHub blob `25b01ea498c2237d59b828a60e71c817be2e5d18`.
- `t16-worker-process.mjs` — syntax PASS; GitHub blob `60d4a825ca6ce4c25dbb8fc0f810a5d639e2a911`.

Result: `2/2` syntax checks PASS.

A direct reconstruction attempt from `raw.githubusercontent.com` was blocked by DNS resolution (`Could not resolve host`). This is recorded as an environmental reconstruction blocker and is not interpreted as candidate or harness failure.

The previously executed neutral T16 evaluator/bridge discriminator remains separate evidence; it does not validate the DBOS runtime driver.

## Runtime boundary

The DBOS T16 candidate experiment has not run against the pinned SDK and PostgreSQL profile in this environment. B001 remains active. Consequently:

- `DBOS_T16_EXECUTOR = IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- `DBOS_T16 = NOT_EXECUTED`
- `DBOS_T16_PASS = NOT_CLAIMED`

Additionally, the formal cleanup gate remains fail-closed. A READY candidate execution cannot become benchmark PASS until candidate cleanup is independently implemented and proven.

## Readiness impact

T16 is no longer globally absent from the formal executor support map because DBOS has a structural slice. This does not open the benchmark. Temporal, Restate and Trigger.dev still lack T16 candidate executors, and additional critical-mutant gaps remain across those candidates. Trigger.dev T7 also remains blocked by the missing actual worker/container SIGKILL boundary (B003).

## CI status

At branch HEAD `1247bf0566c08e68c9c52beb34bbf18780764ca0`, Research Chassis Harness run `33449553726` completed with failure. Node 24 was failure and Node 22 cancelled; both jobs returned `steps=null` and no job logs. Classification remains:

`B002 = REMOTE_CI_RUNNER_UNAVAILABLE_OR_PRE_RUNNER_FAILURE`

This is not harness FAIL evidence.

## Decision state

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `CURRENT_FULL_SUITE = NOT_EXECUTED_AFTER_DBOS_T16_SLICE`
