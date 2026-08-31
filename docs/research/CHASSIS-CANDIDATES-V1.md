# Chassis Candidates V1

Status: PROVISIONAL / NO WINNER SELECTED
Date baseline: 2026-08-31

This matrix records current evidence only. It is intentionally not a final ranking.

## Survivor set

| Candidate | Current state | Strongest evidence | Material risk / constraint |
|---|---|---|---|
| Temporal TypeScript (restricted profile) | SURVIVOR | replay/history model, stale activity completion rejection, mature distributed runtime | external effects still require idempotency/reconciliation; Node/runtime-specific determinism and worker-shutdown issues require hardening |
| DBOS TypeScript | SURVIVOR | Postgres-backed durable steps, recovery/ownership tests, chaos tests, MIT SDK | multi-process automatic recovery introduces Conductor dependency; external effect timing hole still requires idempotency/reconciliation |
| Restate | CHALLENGER | explicit stale-effect fencing, failover/leadership machinery, Jepsen + E2E + release testing | server uses BSL 1.1 rather than OSI open-source license; operational recovery defects must still be reconciled with latest source/tests |
| Trigger.dev | SURVIVOR, LOWER CONFIDENCE | run-level locks, snapshot fencing, transactional attempt start, task-oriented developer experience | no generic durable ambiguous-external-effect reconciliation state; task trigger idempotency is not arbitrary effect idempotency |
| Cadence | HOLD / RESEARCH | mature workflow/retry model, Apache-2.0 | active failover/archival questions and less attractive fit than strongest survivors so far |
| Azure Durable Task | HOLD / RESEARCH | deterministic orchestration/replay | at-least-once activities and operational issues in Azure Storage/hosting paths |

## Candidates currently below survivor threshold

These are not globally rejected projects. They are below threshold for the specific role `NaIa durable execution chassis` under tested/reported configurations.

| Candidate/configuration | Reason |
|---|---|
| LangGraph Python durability path examined | crash/recovery reproduction can duplicate a node side effect depending on checkpoint/write ordering |
| Hatchet self-host / TS path examined | silent task-loss and zombie-worker findings conflict with fail-closed/self-heal requirements |
| Dapr workflow path examined | dead workflow engine with live sidecar / poor failure visibility reported in examined configuration |
| Prefect as primary durable chassis | persistence is useful, but recovery-semantic and external-effect guarantees are weaker for this use |
| Pydantic AI as independent chassis | better treated as an agent layer; durability depends on underlying engines and has had silent-escape/concurrency defects |
| Inngest self-host path examined | step durability mechanisms are real, but self-host recovery/stuck queue findings remain material |

## Source-level findings already verified

### Temporal

- Workflow replay is separated from execution of remote Activities.
- Activity completion paths validate whether an Activity attempt is still current; stale attempts can be rejected.
- Deterministic replay does not imply exactly-once execution of an external system.
- A hardened NaIa profile must pin supported Node/runtime combinations and run replay-history compatibility tests in CI.

Primary repositories:

- https://github.com/temporalio/temporal
- https://github.com/temporalio/sdk-typescript

### DBOS TypeScript

- Durable execution state is Postgres-backed.
- Upstream tests cover recovery, timing holes, outcome ownership, concurrent recovery, queues and chaos scenarios.
- The timing-hole tests explicitly acknowledge ambiguity when an external system may have received an operation before local durable state was written; compensation/idempotency is required.
- Core SDK is MIT.
- Multi-process automatic recovery must be evaluated with the Conductor dependency/operational model rather than assuming the full HA solution is “only Postgres”.

Primary repository:

- https://github.com/dbos-inc/dbos-transact-ts

### Restate

Source inspection confirmed explicit fencing in the server:

- `crates/worker/src/partition/leadership/fencing.rs` tracks a current fencing token per invocation attempt.
- A fresh token is minted for a new/retried invocation attempt.
- Effects from stale attempts are dropped before being proposed to the durable log.
- `crates/worker/src/partition/leadership/mod.rs` contains an integration-style test that performs attempt 1, pauses/fences it, starts attempt 2, injects stale attempt-1 effects, and verifies only current effects enter the log.

Empirical test infrastructure:

- Restate release testing includes unit tests, SDK integration, E2E, Jepsen, upgrade, rollback and cluster-operation testing.
- Public Jepsen suite supports node kill, SIGSTOP and network partition nemeses.
- Public Jepsen workflow had successful runs on 2026-08-30 and 2026-08-31.
- Current default workflow emphasizes `partition-random-node`; this does not prove all supported nemeses pass on every daily run.

License:

- Restate server is BSL 1.1 with an Additional Use Grant and later conversion of each release to Apache-2.0.
- It is therefore not classified as OSI-open-source in the current version.

Primary repositories:

- https://github.com/restatedev/restate
- https://github.com/restatedev/jepsen

### Trigger.dev

- Run engine uses run-level locking and snapshot identity checks.
- Attempt-start state transitions are designed to avoid an intermediate crash window.
- Idempotency keys primarily deduplicate task triggering; they are not a universal transaction around arbitrary external I/O performed inside a task body.

Primary repository:

- https://github.com/triggerdotdev/trigger.dev

## External benchmark handling

`diagrid-labs/durable-execution-battle` is retained as an external reproducible reference, not as an authority for final ranking.

Reasons:

- common driver and raw measurements are useful;
- single-node/default configurations limit generalization;
- failure is primarily injected around a sleep/wait rather than an in-flight irreversible external effect;
- the project has an explicit Diagrid/Dapr perspective.

Repository:

- https://github.com/diagrid-labs/durable-execution-battle

## Open decision

No candidate is allowed to become `BENCHMARK_TO_BEAT` until the same NaIa fault suite is executed against the finalist configurations.
