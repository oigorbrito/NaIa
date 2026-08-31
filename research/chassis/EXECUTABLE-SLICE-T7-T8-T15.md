# Executable Qualification Slice — T7 / T8 / T15

Baseline: 2026-08-31

Decision state remains:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`

This document defines the current executable qualification slice without changing the preregistered critical experiment protocol in `experiment-protocol.v1.json`.

## Scope distinction

`T7` and `T8` are benchmark-critical mutants. When runtime prerequisites are available, isolated T7/T8 evidence may be converted into formal experiment records through `common-runner-record-bridge.mjs` and `common-runner-run-hook.mjs`.

`T15` is currently a non-critical qualification mutant. It is used to validate semantic operation identity and behavior against a deliberately non-idempotent external provider, but it is not one of the six critical mutants in the 2400-record preregistered benchmark ledger. T15 evidence MUST NOT be counted as a substitute for T5, T7, T8, T11, T12, or T16 repetitions.

`COMPOSITE` remains a harness/instrumentation control mode. A composite run combines faults and MUST NOT be counted as an isolated formal T7 or T8 experiment record.

## T7 — process crash after external apply, before checkpoint

Local-process candidates use a neutral post-effect barrier:

1. external oracle applies the effect;
2. adapter emits `external_effect_observed_before_checkpoint`;
3. `NAIA_HOLD_AFTER_EXTERNAL_EFFECT=1` prevents the adapter from returning/checkpointing;
4. crash controller observes the semantic event and sends `SIGKILL`;
5. barrier is disabled on resume;
6. candidate resumes from its durable authority;
7. independent oracle and final status are inspected.

The barrier exists to remove scheduler timing variance between event emission and SIGKILL. It does not implement recovery for the candidate and is common to all local-process candidates.

T7 PASS requires at least:

- intended SIGKILL was issued to the worker process boundary;
- no response-loss fault was injected;
- durable authority remained reachable after the worker death;
- resume completed;
- expected semantic operation was applied;
- exactly one related operation identity exists;
- `totalApplyCount === 1`;
- final status is completed.

Trigger.dev managed-controller mode is not a worker-process T7 test. Its T7 remains `NOT_EXECUTED`/`INCONCLUSIVE` until the self-hosted worker/container boundary can be killed directly.

## T8 — response lost after external apply

T8 is isolated from process death:

1. external oracle applies the effect;
2. oracle drops the first response for that semantic operation;
3. no SIGKILL is issued;
4. candidate retry/recovery behavior proceeds natively;
5. independent oracle and final status are inspected.

T8 PASS requires at least:

- exactly one response loss occurred;
- no process SIGKILL was required;
- candidate completed;
- one operation identity was preserved;
- `totalApplyCount === 1`;
- final status is completed;
- durable authority is reachable.

## T15 — deliberately non-idempotent external provider

The default oracle models provider idempotency by semantic `operationId`: multiple identical requests count as one applied external effect.

T15 explicitly disables that provider protection by sending:

`x-non-idempotent-provider: 1`

Under this mode every request applies the external effect again, even when the `operationId` is unchanged. The oracle records `providerMode = NON_IDEMPOTENT` and increments `applyCount` for every request.

The T15 qualification fault combines a non-idempotent provider with a one-shot lost response to create the ambiguity that normally induces a retry. No process SIGKILL is used.

A safe control reconciles the ambiguous first request by querying independent external state and completes without sending a second external-effect request. Expected result: `PASS`, `requestCount=1`, `applyCount=1`, `responseLossCount=1`.

A blind-retry negative control sends the external effect again after the lost response. Expected result: `FAIL`, `requestCount=2`, `applyCount=2`, `responseLossCount=1`.

This prevents a false conclusion where stable `operationId` alone appears to prove exactly-once behavior only because the test provider itself was idempotent.

Provider mode is immutable per semantic operation. Switching an existing operation from idempotent to non-idempotent mode (or the reverse) returns `409 provider_mode_drift` and does not silently alter experiment semantics.

## Formal evidence boundary

For benchmark-critical records:

- setup blockers remain `BLOCKED`;
- runtime/bootstrap prerequisites discovered after static setup also remain `BLOCKED` and are recorded as `run.blocked=true` with a blocker reason;
- required fault not injected remains `INCONCLUSIVE`;
- cleanup not independently verified after a READY execution fails closed and prevents PASS;
- critical PASS requires a concrete fault target and proof that the durable authority remained reachable.

The formal benchmark ledger remains governed by `experiment-protocol.v1.json`, `experiment-record.schema.v1.json`, `experiment-record-validator.mjs`, and the round-robin execution plan. No result in this slice selects a chassis by itself.
