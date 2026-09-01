# CHASSIS FORMAL PROMOTION PROVENANCE AUDIT — 2026-09-01

## Classification

- Scope: `CHASSIS_ONLY`
- Audit type: `STRUCTURAL_AUDIT`
- Runtime verification: `NOT_RUNTIME_VERIFIED`
- Remote execution status: `BLOCKED_REMOTE_CI_PRE_RUNNER`
- Formal ledger append: `CLOSED`
- Benchmark selection: `NOT_SELECTED`
- Chassis winner: `NOT_SELECTED`

This audit changes no candidate semantic verdict and does not promote any lifecycle or cleanup-support status.

## Controlled-test boundary

- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Methodological basis

The existing experiment protocol already cites NIST SP 1500-18r2 and ACM reproducibility/artifact-evaluation guidance and freezes execution order, repetition count, seeds, record provenance and verdict classification before formal execution.

This audit additionally applies the registered-report / preregistration principle used in empirical software-engineering studies: analysis and decision rules are defined before outcomes are observed, and later deviations are reported explicitly rather than silently incorporated into the original decision rule.

Relevant empirical-software-engineering examples:

- `An exploratory study of bug-introducing changes: exploring relationships in bug-introducing changes towards causal understanding`, Empirical Software Engineering (2026), DOI: `10.1007/s10664-026-10822-6`. The study states that its protocol was preregistered, analysis approach and expectations were defined beforehand, and deviations were reported separately.
- `Software development metrics: to VR or not to VR`, Empirical Software Engineering (2024), DOI: `10.1007/s10664-023-10435-3`. The paper reports changes from its registered report explicitly rather than treating them as if they were part of the original frozen plan.
- González-Barahona and Robles, `On the reproducibility of empirical software engineering studies based on data retrieved from development repositories`, Empirical Software Engineering 17 (2012), DOI: `10.1007/s10664-011-9181-9`, emphasizing systematic identification of data, methods, parameters and tools needed to reproduce a study.

## Finding F1 — runtime accepted-failure policy was post-hoc capable

`benchmark-promotion-gate.mjs` previously accepted caller-supplied `acceptedFailures` and `enforcedPolicies` maps during promotion assessment.

The frozen protocol permits `FAIL` as an observed verdict and defines benchmark comparability in terms of complete critical-mutant records without `BLOCKED` or `INCONCLUSIVE`. It does not preregister a concrete exception that turns a critical `FAIL` into a promotion-qualified result.

Therefore a caller-supplied exception after observing outcomes would create a post-hoc decision rule.

Disposition:

- caller-supplied promotion overrides are now non-authoritative;
- critical `FAIL` remains comparable evidence but cannot be waived unless an exception was versioned before formal execution;
- `PARTIAL` can qualify only where the fault suite permits it and a concrete enforced policy was versioned before formal execution.

## Finding F2 — promotion exception policy frozen before formal execution

New machine-readable artifact:

`research/chassis/formal-promotion-policy.v1.json`

Frozen state:

- `status = FROZEN_BEFORE_FORMAL_EXECUTION`
- `acceptedCriticalFailures = {}`
- `partialPolicies = {}`

Thus no critical `FAIL` or `PARTIAL` exception is currently preregistered.

Any future change must use a new version and be recorded as a protocol deviation. This V1 file must not be rewritten after formal outcomes are observed.

## Finding F3 — policy version is cryptographically bound to formal records

New authority module:

`research/chassis/harness/formal-promotion-policy.mjs`

It computes SHA-256 over the frozen policy artifact and exposes immutable policy provenance.

`formal-single-run.mjs` now stamps every formal record with:

- policy path;
- schema version;
- frozen status;
- SHA-256.

`benchmarkEligible()` rejects a required critical-mutant record if its policy provenance does not match the current frozen V1 policy.

`auditStoredFormalRecord()` and `auditStoredFormalLedger()` apply the same check to stored ledger evidence. Therefore changing the policy after records were generated makes those records fail the current formal-promotion audit rather than silently changing their interpretation.

## Finding F4 — promotion requires immutable ledger audit

`assessBenchmarkPromotion()` now requires both:

1. a complete valid preregistered execution ledger; and
2. a valid immutable formal-provenance audit for the complete ledger.

Candidate-level promotion still passes through `benchmarkEligible()`, which requires:

- evidence-backed runtime-verified cleanup support bound to the candidate;
- runtime-verified lifecycle provenance;
- current frozen promotion-policy hash provenance;
- complete PASS pre-run cleanup receipt for READY execution;
- PASS post-run cleanup for READY execution;
- explicit worker-process PID provenance and PID-to-cleanup binding;
- all required unique repetitions without gaps;
- no `BLOCKED` or `INCONCLUSIVE` critical records.

## Finding F5 — formal harness aggregate hash omitted active authorities

The formal aggregate harness provenance previously omitted several components that now affect execution or promotion authority, notably:

- DBOS formal lifecycle;
- formal lifecycle router;
- worker-PID provenance gate;
- promotion-policy loader;
- lifecycle receipt validator;
- lifecycle promotion review;
- frozen promotion-policy JSON.

`FORMAL_HARNESS_FILES` now includes those components. A change to them therefore changes the aggregate formal `harnessSha256` produced for subsequent formal runs.

The coverage test was expanded to lock these inclusions structurally.

## Finding F6 — record schema now describes the formal provenance fields

`experiment-record.schema.v1.json` now explicitly describes optional formal fields used by the qualification gate:

- `setup.environment.formalPromotionPolicy`;
- `setup.environment.formalRuntimeLifecycle`;
- `run.rawObservations.workerProcessPids`;
- `cleanup.observedWorkerPids`;
- `cleanup.liveObservedWorkerPids`.

This does not promote pilot evidence or change the frozen experiment protocol. It makes the already-enforced formal evidence shape machine-readable.

## CI evidence

Latest inspected main harness run before this audit note:

- run: `33533190518`
- head at run: `384650b8b80dfda81c246abe2bf2c21dc30212e9`
- `neutral-oracle (24)`: `failure`, `steps=null`
- `neutral-oracle (22)`: `failure`, `steps=null`

Because no job step started, this remains `BLOCKED_REMOTE_CI_PRE_RUNNER` and is not harness FAIL, candidate FAIL or test PASS.

The expanded Node-only structural suite is therefore `IMPLEMENTED_NOT_RUNTIME_VERIFIED` until a runner actually starts steps.

## Current formal state

- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`
- Temporal cleanup support: `preRunCleanup=false`, `postRunCleanup=false`
- DBOS cleanup support: `preRunCleanup=false`, `postRunCleanup=false`
- formal ledger append: `CLOSED`
- `BENCHMARK_TO_BEAT=NOT_SELECTED`
- `CHASSIS_WINNER=NOT_SELECTED`

## Next admissible evidence

When GitHub Actions actually starts runner steps:

1. execute the Node-only formal provenance / worker-PID / promotion structural suite;
2. execute the preregistered isolated T5/r1 lifecycle receipt for Temporal and DBOS;
3. retain record, validator output, hashes and execution reference;
4. only after valid runtime receipts consider changing lifecycle status and cleanup-support booleans to `RUNTIME_VERIFIED`;
5. then run the targeted Temporal T7/T8/T11/T16 reconciliation under the fixed harness;
6. only after those gates are clean begin the formal 100-repetition round-robin experiment.

No benchmark or chassis winner is declared by this audit.
