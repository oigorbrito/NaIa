# CHASSIS FORMAL ENVIRONMENT IDENTITY AUDIT — 2026-09-01

## Classification

- Scope: `CHASSIS_ONLY`
- Audit type: `STRUCTURAL_AUDIT`
- Runtime verification: `NOT_RUNTIME_VERIFIED`
- Remote execution status: `BLOCKED_REMOTE_CI_PRE_RUNNER`
- Formal protocol status: `SPECIFIED_NOT_EXECUTED`
- Formal ledger append: `CLOSED`
- Benchmark selection: `NOT_SELECTED`
- Chassis winner: `NOT_SELECTED`

This audit changes no candidate semantic verdict and does not promote lifecycle, cleanup-support, ledger or benchmark status.

## Controlled-test boundary

- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Methodological basis

The preregistered chassis protocol cites NIST SP 1500-18r2 Research Data Framework and ACM artifact/reproducibility guidance and requires software, environment, parameters, methods, inputs, outputs and provenance to be recorded before formal comparison.

Environment comparability is now frozen explicitly in protocol amendment `A002`, while protocol status remains `SPECIFIED_NOT_EXECUTED`:

`single-common-runtime-and-candidate-profile-per-formal-ledger`

`A002` states that the rule is not outcome-driven, changes no semantic verdict and changes no repetition threshold.

## Finding E1 — common execution environment identity is explicit

For every `READY` formal record, `formal-environment-identity.mjs` derives one canonical common environment from:

- operating system identity;
- architecture;
- Node runtime;
- recorded package-manager identity.

One formal ledger may not mix different common-environment fingerprints.

A drift therefore creates a new experimental-series boundary. It is not classified as candidate `FAIL`.

## Finding E2 — candidate runtime profile is separately frozen

Within each candidate, the canonical profile includes:

- candidate version;
- candidate source reference;
- adapter SHA-256;
- package-manifest SHA-256;
- exact expected, declared and installed dependency versions;
- declared execution mode;
- worker authority boundary;
- lifecycle-qualification SHA-256;
- stable native-runtime identity.

Temporal native identity includes the frozen CLI digest/version profile and observed platform. DBOS native identity includes Docker version and frozen PostgreSQL image identity.

Different candidates may have different candidate profiles while remaining comparable when the common execution environment is the same.

## Finding E3 — dynamic run-local identifiers are excluded

The canonical identity intentionally excludes values that identify an individual isolated execution rather than the software/runtime profile, including:

- workspace paths;
- loopback ports/addresses;
- process IDs;
- task-queue names;
- container IDs;
- database URLs.

This prevents harmless isolation coordinates from falsely fragmenting one otherwise identical experimental series.

## Finding E4 — exact dependency mismatch fails closed before comparison

A `READY` record is not accepted as a valid formal environment identity when expected, declared and installed dependency versions differ or required identity fields are absent.

The rule is enforced by:

- formal record historical audit;
- formal ledger append consistency;
- candidate `benchmarkEligible()` comparability;
- final benchmark-promotion gate.

Blocked setup remains `BLOCKED`; environment-identity rejection does not create a candidate semantic `FAIL`.

## Finding E5 — environment authority is bound into provenance

`formal-environment-identity.mjs` is included in:

- `FORMAL_HARNESS_FILES`, so changing the rule changes the aggregate formal harness identity;
- the Temporal/DBOS lifecycle-qualification provenance bundle, so changing the rule invalidates stale lifecycle qualification support;
- the structural GitHub Actions gate and targeted lifecycle qualification path set.

Thus the environment comparison rule cannot change silently without changing the formal provenance identities used by later records.

## Structural test coverage

`formal-environment-identity.test.mjs` now covers:

- dynamic paths/ports/PIDs/queues/container IDs excluded from identity;
- OS drift;
- architecture drift;
- Node runtime drift;
- package-manager drift;
- candidate version/source drift;
- adapter and manifest drift;
- execution mode and authority-boundary drift;
- lifecycle-qualification drift;
- Temporal CLI/runtime identity drift;
- DBOS Docker/runtime drift;
- missing installed dependency identity;
- different candidate profiles sharing one common execution environment;
- rejection of mixed candidate profiles or common environments.

`formal-ledger-environment-consistency.test.mjs` additionally exercises ledger append across Temporal and DBOS and rejects an append that crosses the frozen common environment identity.

These tests are source-level evidence only until an actual runner executes them.

## Remote CI evidence

Latest inspected structural run for the current audit state:

- head: `122325a37235988ce0494cde79adadd25e3857d9`
- workflow run: `33548809747`
- job: `99992874955`
- conclusion: `failure`
- job steps: `null`

No checkout, Node setup or test command started. Classification therefore remains:

`BLOCKED_REMOTE_CI_PRE_RUNNER`

It is not a harness failure, candidate failure or test pass.

## Current formal state

- Formal environment identity: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- Formal ledger append: `CLOSED`
- `BENCHMARK_TO_BEAT=NOT_SELECTED`
- `CHASSIS_WINNER=NOT_SELECTED`

## Next admissible evidence

When a runner actually starts steps, execute the structural provenance/environment suite and then the isolated Temporal/DBOS T5/r1 lifecycle qualification. Only runtime evidence from the frozen revision/harness/environment series may open lifecycle support or formal benchmark execution.
