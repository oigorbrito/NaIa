# Empirical Harness Methodology V1

Status: SPECIFIED_NOT_EXECUTED

This document constrains the chassis harness to practices supported by empirical software-engineering and reproducibility guidance. It is intentionally narrower than a general engineering wish list.

## Evidence basis

The harness design is derived from the following methodological requirements:

1. Experimental validation must distinguish observed results from unexecuted or inferred claims.
2. An experiment must expose enough detail to be independently repeated without private communication with the original investigator.
3. Artifacts should include system/source identity, configuration, build/runtime environment, input data or input-generation procedure, workload, measurement protocol, raw outputs, and scripts needed to reproduce derived results.
4. Experiment phases should be explicit and checkable: setup, run, and cleanup.
5. Automation is preferred over manual mutation of scripts or constants.
6. Environment, tool versions, parameters, provenance, and data-capture methods must be recorded.
7. Repetition must be explicit when stochastic scheduling, races, timing, or failure injection can affect outcomes.
8. Failures of the experiment infrastructure must be reported separately from failures of the system under test.
9. Claims should be traceable to raw observations and machine-readable acceptance checks.
10. Reproduction by a separate environment/person is stronger evidence than an author-only rerun and must not be conflated with repeatability.

Primary methodological sources used for these constraints:

- Zelkowitz & Wallace, Experimental Validation in Software Engineering, Information and Software Technology / NIST publication record.
- ACM Artifact Review / reproducibility guidance, including documented, complete, exercisable artifacts and reproducible setup-run-cleanup procedures.
- NIST TN 1830, software performance measurement rigor, repeatability, comparability and verifiability.
- NIST Research Data Framework, including tool/parameter specification, methods/protocols, capture methods, provenance and reproducibility metadata.

## Required experiment phases

Every mutant execution SHALL record the following phases independently:

### SETUP

Purpose: establish the declared experimental conditions.

Minimum record:

- candidate and exact version;
- candidate source revision/tag when available;
- adapter source SHA;
- harness source SHA;
- dependency lock/integrity identity when dependencies are installed;
- operating system and architecture;
- runtime and package-manager versions;
- relevant infrastructure versions;
- required environment variable names, with secret values redacted;
- experiment parameters;
- objective identity and external operation identity;
- cleanup verification from the previous repetition.

A setup phase that cannot prove its required conditions yields `BLOCKED_SETUP`, not candidate FAIL.

### RUN

Purpose: apply exactly the declared workload and fault primitive and collect raw observations.

Minimum record:

- mutant ID;
- repetition number;
- start/end timestamps;
- workload parameters;
- fault trigger condition;
- actual injected fault;
- identity of the process/container/resource affected by the fault;
- durable authority expected to remain alive;
- raw adapter events;
- raw oracle observations;
- process exit codes/signals;
- status snapshots before and after recovery;
- whether the intended fault was actually reached.

If the intended fault was not actually injected, the result is `INCONCLUSIVE_FAULT_NOT_INJECTED`.

### CLEANUP

Purpose: avoid cross-repetition contamination.

Minimum record:

- worker/process cleanup result;
- durable state cleanup/reset policy;
- oracle state cleanup/reset result;
- temporary resource cleanup result;
- verification that no stale worker from the previous repetition is still authoritative unless the next experiment intentionally tests stale authority.

Cleanup failure invalidates the next repetition until corrected.

## Repetition policy

The harness SHALL NOT infer reliability from a single scheduling-sensitive run.

- Deterministic static checks may use one execution.
- Crash/restart, concurrency, stale-owner, cancellation-race and response-loss mutants use the repetition count specified by `fault-suite.v1.json`.
- Every repetition produces an independent raw record.
- Aggregation is a derived artifact and must preserve links to all raw records.
- Missing repetitions are not silently discarded.

## Result vocabulary

Candidate verdicts are restricted to:

- `PASS`: the intended experiment executed and all predeclared acceptance checks passed.
- `FAIL`: the intended experiment executed and at least one predeclared candidate acceptance check failed.
- `BLOCKED`: experiment prerequisites or infrastructure prevented execution before the candidate behavior could be measured.
- `INCONCLUSIVE`: execution occurred but the intended fault/measurement condition was not established strongly enough to support PASS or FAIL.
- `PARTIAL`: allowed only where `fault-suite.v1.json` explicitly permits an enforced external policy to satisfy part of the claim.

`NOT_EXECUTED` is metadata state, not an experiment verdict.

## Separation of claims

The harness SHALL keep these classes separate:

- source/documentation evidence;
- static adapter-contract evidence;
- local repeated execution;
- independent reproduction in another environment;
- benchmark-selection decision.

No lower class may be promoted to a higher class without the corresponding artifact.

## Raw-data preservation

For each execution the harness SHALL preserve:

- experiment manifest;
- environment manifest;
- stdout/stderr or structured event logs;
- external oracle snapshot;
- fault-injection receipt;
- status snapshots;
- acceptance-check result;
- cleanup receipt;
- hashes of the above artifacts.

Derived summaries SHALL NOT replace raw records.

## Comparability rule

Candidate comparisons are valid only when the semantic workload, acceptance rule, external oracle behavior, and mutant intent are equivalent. Candidate-native mechanisms may differ, but the experimental claim must remain the same.

If equivalence cannot be established, report `INCOMPARABLE` at the comparison layer rather than manufacturing a rank.

## Decision guard

`BENCHMARK_TO_BEAT` and `CHASSIS_WINNER` remain `NOT_SELECTED` until all benchmark-critical mutants satisfy the eligibility rules in `fault-suite.v1.json` with executed, reproducible evidence.