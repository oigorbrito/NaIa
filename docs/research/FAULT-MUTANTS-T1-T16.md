# NaIa Common Fault Mutants T1–T16

Status: SPECIFIED / NOT YET EXECUTED LOCALLY
Version: 1
Date baseline: 2026-08-31

This suite is the common acceptance battery for durable-execution chassis candidates.

The purpose is not to prove that an engine is “perfect”. It is to determine whether its failure semantics are explicit, reproducible, observable and acceptable for a personal/family assistant that may execute real-world actions.

## Common workflow

Every candidate must implement an equivalent workflow:

1. accept objective;
2. persist objective identity;
3. execute internal durable step A;
4. emit evidence A;
5. wait on durable timer;
6. request human approval;
7. resume after approval;
8. execute external-effect step B using stable operation identity;
9. persist external result/evidence;
10. verify final state;
11. complete objective.

Adapters may use native primitives, but semantics must remain equivalent.

## Invariants

- Objective identity remains stable across restarts.
- A stale worker/attempt cannot overwrite newer authority.
- Completed internal durable work is not silently lost.
- Duplicate external effects are either prevented by protocol or detected/reconciled explicitly.
- Ambiguous external effect state is never silently reported as success.
- Cancellation prevents future unauthorized progress.
- Human approval remains authoritative across restart.
- Dead/degraded execution cannot remain falsely healthy indefinitely.
- Every terminal verdict has machine-readable evidence.

## Mutants

| ID | Fault injection | Required observation |
|---|---|---|
| T1 | Kill before durable step A starts | restart resumes and executes A once under current authority |
| T2 | Kill while A is executing | engine exposes deterministic retry/recovery semantics |
| T3 | A completes, kill before next checkpoint | already-durable A is reused; non-durable ambiguity is explicit |
| T4 | Checkpoint persists, worker dies immediately | restart continues from persisted state |
| T5 | Two workers race for same objective/step | one current authority; stale completion rejected or safely adopted |
| T6 | Persistence backend unavailable before commit | no false success; retry/backoff/failure is observable |
| T7 | External effect completes, persistence fails before ACK | result becomes AMBIGUOUS/PENDING_RECONCILIATION or deduplicates via provider key; never blind success |
| T8 | Connection drops after request delivery but before response | same as T7; recovery must not assume request was absent |
| T9 | Durable timer pending during process restart | timer survives and fires no earlier than allowed semantic time |
| T10 | Human approval pending during restart | approval state survives; no duplicate request unless policy requires it |
| T11 | Cancel races with crash/retry | no unauthorized post-cancel external effect |
| T12 | Old worker completes after new worker/attempt owns work | stale completion is fenced/rejected |
| T13 | Replay after supported runtime/SDK upgrade | history remains compatible or upgrade is fail-closed with migration guidance |
| T14 | Long-running workflow/history growth | bounded/managed history and predictable recovery behavior |
| T15 | Deliberately non-idempotent external provider | chassis must classify as unsafe/conditional; cannot manufacture exactly-once |
| T16 | Tool/config/workflow identity changes before recovery | wrong function/tool/config must never be silently resumed; mismatch must fail closed or use versioned identity |

## Verdict vocabulary

`PASS`
: property demonstrated with reproducible evidence under the tested configuration.

`PARTIAL`
: property exists but requires an explicit application/provider condition.

`FAIL`
: reproducible violation of a required invariant.

`BLOCKED`
: environment/tooling prevented execution; no inference is allowed.

`INCONCLUSIVE`
: evidence is conflicting or insufficient.

## External-effect oracle

A mock external service must expose:

- operation id / idempotency key;
- request count;
- apply count;
- first-applied timestamp;
- final resource state;
- configurable response loss after apply;
- configurable latency;
- configurable 5xx/timeout behavior.

The oracle is authoritative for whether an external effect happened. The workflow engine's local state alone is not sufficient.

## Crash controller

The harness must support deterministic kill points:

- before external request;
- immediately after external server applies operation;
- before engine records completion;
- after engine records completion;
- during approval wait;
- during timer wait;
- during persistence outage;
- during ownership transfer.

Kill must be process-level where possible, not a caught application exception.

## Required output per run

```text
candidate=
version=
commit=
runtime=
deployment_profile=
mutant=
run_id=
objective_id=
operation_id=
worker_attempts=
external_request_count=
external_apply_count=
terminal_state=
reconciliation_state=
stale_completion_accepted=
false_health_detected=
evidence_complete=
verdict=
```

## Minimum repetition

For deterministic single-process mutants: at least 10 clean repetitions before PASS.

For race/concurrency/network mutants T5, T7, T8, T11 and T12: at least 100 repetitions or a stronger model-checking/Jepsen-style procedure.

A single failure is sufficient to reject PASS and open investigation.

## Final qualification rule

A chassis configuration cannot become `BENCHMARK_TO_BEAT` while any of T5, T7, T8, T11, T12 or T16 is `INCONCLUSIVE` or `BLOCKED`.

`PARTIAL` is allowed for T7/T8/T15 only when the condition is explicit, enforced by NaIa policy, and covered by reconciliation tests.
