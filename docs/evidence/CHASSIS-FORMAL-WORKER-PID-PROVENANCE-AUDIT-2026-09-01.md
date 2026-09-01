# CHASSIS FORMAL WORKER PID PROVENANCE AUDIT — 2026-09-01

## Classification

- Scope: `CHASSIS_ONLY`
- Audit type: `STRUCTURAL_AUDIT`
- Runtime verification: `NOT_RUNTIME_VERIFIED`
- Remote execution status: `BLOCKED_REMOTE_CI_PRE_RUNNER`
- Benchmark selection: `NOT_SELECTED`
- Chassis winner: `NOT_SELECTED`

This audit changes no candidate semantic verdict and does not promote any lifecycle or cleanup support status.

## Controlled-test boundary

- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Finding F1 — empty PID observation could be misclassified as clean

The Temporal and DBOS formal lifecycle cleanup implementations originally determined worker cleanup from the absence of live observed PIDs. An empty observed PID set could therefore satisfy the liveness condition even if a driver regression had stopped emitting worker PID provenance.

Risk: `zero observed PIDs` could be confused with `all expected worker PIDs were observed and are dead`.

Disposition: corrected both at the lifecycle source and at downstream authority boundaries. A READY critical execution with the intended fault actually injected now requires explicit worker-process provenance. Missing provenance makes lifecycle `workerCleanup=false`; formal ledger admission and benchmark eligibility independently fail closed as defense in depth.

## Finding F2 — driver PID is not worker PID

Dedicated T11/T12/T16 run hooks now preserve their driver process PID for general process provenance. That PID is not accepted as a substitute for a worker PID.

The formal contract distinguishes:

- generic process observations such as driver/coordinator/status process PIDs; and
- `run.rawObservations.workerProcessPids`, the explicit set of execution-boundary worker PIDs.

A critical injected formal run with only a driver PID is rejected by lifecycle cleanup, formal ledger admission, lifecycle promotion review where applicable, and benchmark eligibility.

## Worker PID sources by mutant

### T5

The T5 record bridge derives `workerProcessPids` from native evidence for worker A and worker B.

### T7

For local-process profiles, the common runner's initial and resumed adapter processes are the worker execution boundary. Their process IDs are exported explicitly. Managed-controller T7 remains unqualified when the actual worker process/container is not addressable.

### T8

For the isolated response-loss profile, the active adapter process is the execution boundary. Its PID is exported explicitly; the status query process is not promoted to worker identity.

### T11

The T11 bridge derives explicit worker PIDs from native worker A and recovery worker B evidence. The outer driver PID is retained separately and is not sufficient for worker provenance.

### T12

The T12 bridge derives explicit worker PIDs from native old-authority worker A and new-authority worker B evidence.

### T16

The T16 bridge derives explicit worker PIDs from the A/B/C semantic-profile worker sequence when present.

## Finding F3 — worker identity must be bound to cleanup evidence

Merely declaring `workerProcessPids` is insufficient. For every READY critical execution with `fault.injected=true`:

1. `workerProcessPids` must be non-empty;
2. every explicit worker PID must appear in `cleanup.observedWorkerPids`;
3. no explicit worker PID may appear in `cleanup.liveObservedWorkerPids`;
4. the existing formal requirement for `cleanup.status=PASS` still applies.

This binding is enforced by shared worker-PID cleanup evidence validation and consumed by both formal ledger admission and `benchmarkEligible()`.

Thus a record cannot become formal/benchmark evidence merely by adding a worker PID field after execution or by proving only that a driver exited.

## Finding F4 — lifecycle promotion receipt hardened

The T5/r1 lifecycle receipt validator additionally requires:

- explicit worker process PIDs;
- non-empty cleanup PID observation;
- every explicit worker PID included in the cleanup observation;
- no observed worker PID alive after cleanup;
- all previously required setup, frozen-profile, durable-authority, resource-cleanup and candidate-specific checks.

Candidate semantic PASS/FAIL remains independent from lifecycle cleanup verification.

## Finding F5 — promotion review remains non-authoritative by itself

The lifecycle promotion review recomputes receipt eligibility from the immutable record. Test fixtures include explicit worker PID provenance and cleanup binding. A forged validator eligibility flag or driver-only provenance must not produce a support-promotion proposal.

The review still cannot:

- append a benchmark ledger record;
- select a benchmark;
- select a chassis winner; or
- mutate `FORMAL_CLEANUP_SUPPORT` automatically.

## Finding F6 — root lifecycle cleanup now fails closed

Both candidate lifecycle implementations now consume the shared PID-provenance assessment during post-run cleanup.

For a READY critical execution with `fault.injected=true`:

- no explicit worker PID provenance => `workerCleanup=false`;
- any observed process still alive => `workerCleanup=false`;
- explicit worker PIDs plus all observed processes dead => worker cleanup may pass, subject to durable state, oracle and temporary resource cleanup.

For `BLOCKED_SETUP` or a run where the intended critical fault was not injected, missing worker PID provenance does not create an artificial candidate or cleanup failure. This preserves the experiment classification rule `BLOCKED != FAIL != PASS`.

Temporal and DBOS lifecycle receipts now also expose:

- `workerPidProvenanceRequired`;
- `workerPidProvenanceObserved`;
- `workerProcessPids`;
- `observedWorkerPids`; and
- `liveObservedWorkerPids`.

The corresponding lifecycle tests include explicit fail-closed fixtures. They remain `IMPLEMENTED_NOT_RUNTIME_VERIFIED` until a runner executes them.

## Structural test gate

A minimal workflow exists:

`.github/workflows/research-chassis-worker-pid-provenance.yml`

It requires only Node 22.16.0 and repository checkout. It does not require Temporal, DBOS, PostgreSQL, Docker, provider credentials, or external services because the lifecycle tests use controlled fake operations.

Its targeted structural suite covers:

- explicit worker PID provenance helper;
- Temporal lifecycle cleanup;
- DBOS lifecycle cleanup;
- common-runner T7/T8 bridge;
- T5 bridge;
- lifecycle receipt validation;
- lifecycle promotion review;
- formal ledger admission; and
- benchmark record eligibility.

GitHub Actions run `33529745038` failed before any step was created/executed (`steps=null`). Therefore the suite is classified `IMPLEMENTED_NOT_RUNTIME_VERIFIED`, not PASS or FAIL.

This independent minimal workflow strengthens the existing classification `BLOCKED_REMOTE_CI_PRE_RUNNER`: the current blocker is upstream of checkout/Node tests and is not attributable to candidate SDK, Docker, PostgreSQL, Temporal CLI, or runtime fault injection.

## Current formal gate state

- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- Temporal `preRunCleanup=false`
- Temporal `postRunCleanup=false`
- DBOS `preRunCleanup=false`
- DBOS `postRunCleanup=false`
- `FORMAL_LEDGER_APPEND=CLOSED`
- `BENCHMARK_TO_BEAT=NOT_SELECTED`
- `CHASSIS_WINNER=NOT_SELECTED`

No support boolean or lifecycle status is promoted by this structural audit.

## Next admissible runtime evidence

When a runner actually begins executing steps, retain the preregistered T5/r1 lifecycle probe for Temporal and DBOS. Promotion review may be considered only if the runtime record proves the explicit worker PID set, cleanup observation contains the same worker identities, no worker remains alive, candidate-specific durable resources are removed, frozen runtime identity is verified, and the receipt/promotion-review hashes are retained.

Until then, runtime-dependent claims remain blocked rather than inferred from source inspection.
