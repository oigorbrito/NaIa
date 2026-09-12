# Empirical Harness Methodology V1

Status: SPECIFIED_NOT_EXECUTED

This document constrains the chassis harness to practices supported by empirical software-engineering and reproducibility guidance. It is intentionally narrower than a general engineering wish list.

## Evidence basis

The harness design is derived from the following methodological requirements:

1. Experimental validation must distinguish observed results from unexecuted or inferred claims.
2. An experiment must expose enough detail to be independently repeated without private communication with the original investigator.
3. Artifacts should include system/source identity, configuration, build/runtime environment, input data or input-generation procedure, workload, measurement protocol, raw outputs, and scripts needed to reproduce derived results.
4. Experiment phases should be explicit and checkable: setup, run, and cleanup.
5. Automation is preferred over manual mutation of scripts or constants when it reduces operator-dependent variation.
6. Environment, tool versions, parameters, provenance, and data-capture methods must be recorded.
7. Repetition must be explicit when stochastic scheduling, races, timing, or failure injection can affect outcomes.
8. Failures of the experiment infrastructure must be reported separately from failures of the system under test.
9. Claims should be traceable to raw observations and machine-readable acceptance checks.
10. Independent reproduction is stronger evidence than an author-only rerun and must not be conflated with local repeatability.
11. Artifact quality claims must distinguish documentation/completeness/exercisability from actual reproduced results.
12. Candidate comparisons are valid only when the experimental claim, workload semantics, measurement protocol, and acceptance rule remain equivalent.
13. Evidence is claim-scoped: evidence produced for one measured claim or evaluation domain must not be silently reused as proof of a different claim merely because it shares repository, branch, or source lineage.

Primary methodological sources used for these constraints:

- Zelkowitz & Wallace, Experimental Validation in Software Engineering, Information and Software Technology / NIST publication record.
- ACM Artifact Review / reproducibility guidance, especially documented, consistent, complete, exercisable artifacts and independently reproduced results.
- NIST TN 1830, software performance measurement rigor, repeatability, comparability and verifiability.
- NIST Research Data Framework, including tool/parameter specification, methods/protocols, capture methods, provenance, versioning, computational conditions and reproducibility metadata.

The repository-local mapping from source concepts to harness rules is recorded in `METHODOLOGY-SOURCE-MAP-V1.md`.

## Methodological scope and non-goals

The harness SHALL NOT treat undocumented engineering preference as empirical methodology.

A proposed harness improvement is methodologically admissible only when all of the following are recorded:

- the specific claim or reproducibility risk being addressed;
- the methodological source category supporting the change;
- the observable artifact or measurement the change will add or strengthen;
- the acceptance/comparability consequence of the change;
- whether the change modifies the experiment contract or only improves documentation/instrumentation.

Suggestions that cannot satisfy this rule remain `UNSUPPORTED_SUGGESTION` and MUST NOT be presented as required empirical practice.

This rule does not prohibit ordinary product engineering. It only prevents product-engineering preference from being mislabeled as an empirical/reproducibility requirement.

## Claim-to-evidence record

Every benchmark-relevant claim SHALL be traceable through a minimum record with these fields:

- `claimId`;
- claim text;
- evidence class;
- exact candidate/version identity;
- exact harness/adapter identity;
- procedure/command;
- environment identity;
- input/workload identity;
- raw artifact references;
- predeclared acceptance rule;
- observed result;
- limitations or unresolved uncertainty;
- decision derived from the result.

A summary without raw-artifact references is not sufficient to support a benchmark-selection claim.

## Claim-domain isolation

Evidence SHALL remain scoped to the claim domain it actually measures.

When an artifact from another repository area or validation flow is cited, the harness SHALL record:

- the source claim domain;
- the target claim being supported;
- the exact source/procedure identity;
- whether the artifact is runtime evidence for the same claim or only contextual/documentary evidence;
- the strongest conclusion the artifact actually licenses.

Evidence strength cannot be transferred across unrelated claims. In particular:

```text
PRODUCT_READINESS_PASS != CHASSIS_CANDIDATE_PASS
HARNESS_CONTROL_PASS != CANDIDATE_PASS
STATIC_VERIFIED != RUNTIME_PASS
REPEATABLE_LOCAL != REPRODUCED_INDEPENDENT
PRE_EXECUTION_INFRA_FAILURE != SYSTEM_UNDER_TEST_FAIL
```

A merge, cherry-pick, branch movement, or documentary reconciliation may preserve a historical evidence reference but does not manufacture a new execution on the resulting revision.

The current NaIA product-readiness/chassis application of this rule is documented in `PRODUCT-READINESS-EVIDENCE-BOUNDARY-V1.md`. That document adds no new product gate or benchmark criterion.

## Evidence classes

The harness SHALL keep the following classes distinct:

1. `DOCUMENTED`: supported only by source documentation or repository inspection.
2. `STATIC_VERIFIED`: supported by deterministic static checks or contract validation, but not runtime behavior.
3. `REPEATABLE_LOCAL`: the declared procedure was executed in the investigator environment with preserved raw evidence and required repetitions.
4. `REPRODUCED_INDEPENDENT`: another environment/person obtained the claim-relevant result from the documented artifact/procedure without private corrective information.
5. `DECISION_ELIGIBLE`: all evidence required by the benchmark gate exists at the required class and the candidates are comparable.

No evidence class may be silently promoted. `DOCUMENTED` or `STATIC_VERIFIED` does not imply runtime PASS; `REPEATABLE_LOCAL` does not imply independent reproduction.

Evidence-class labels are attached to claims, not to repositories or commits globally. A revision may contain strong evidence for one claim and no executed evidence for another.

## Required experiment phases

Every mutant execution SHALL record the following phases independently.

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
- If the procedure, workload, acceptance rule or relevant environment identity changes materially, subsequent runs belong to a new experiment series rather than being merged into the prior series without qualification.

## Result vocabulary

Candidate verdicts are restricted to:

- `PASS`: the intended experiment executed and all predeclared acceptance checks passed.
- `FAIL`: the intended experiment executed and at least one predeclared candidate acceptance check failed.
- `BLOCKED`: experiment prerequisites or infrastructure prevented execution before the candidate behavior could be measured.
- `INCONCLUSIVE`: execution occurred but the intended fault/measurement condition was not established strongly enough to support PASS or FAIL.
- `PARTIAL`: allowed only where `fault-suite.v1.json` explicitly permits an enforced external policy to satisfy part of the claim.

`NOT_EXECUTED` is metadata state, not an experiment verdict.

Infrastructure failure SHALL NOT be converted into candidate FAIL unless the candidate itself is the infrastructure component under test and the failure is within the predeclared claim.

## Separation of claims

The harness SHALL keep these classes separate:

- source/documentation evidence;
- static adapter-contract evidence;
- local repeated execution;
- independent reproduction in another environment;
- benchmark-selection decision.

No lower class may be promoted to a higher class without the corresponding artifact.

Different validation domains SHALL also remain separate when they answer different questions. A product-readiness receipt may be preserved as product evidence but cannot substitute for missing chassis experiment records; conversely, chassis evidence cannot redefine product gates or product-readiness thresholds.

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

The package should be structured so that a reviewer can identify what was run, on which version, with which inputs and conditions, and how the verdict was derived from raw observations.

## Comparability rule

Candidate comparisons are valid only when the semantic workload, acceptance rule, external oracle behavior, measurement meaning, and mutant intent are equivalent. Candidate-native mechanisms may differ, but the experimental claim must remain the same.

If equivalence cannot be established, report `INCOMPARABLE` at the comparison layer rather than manufacturing a rank.

A post-hoc change to the acceptance rule or workload semantics requires either re-execution of all compared candidates under the revised contract or an explicit `INCOMPARABLE`/new-series classification.

Similarity of repository revision, product feature set, or implementation architecture is not by itself evidence of experimental comparability; comparability is claim/procedure/measurement-specific.

## Documentation quality gate

Before candidate-scale execution, the harness documentation SHALL be checked for the artifact properties used by ACM artifact evaluation:

- documented: inventory and instructions exist;
- consistent: artifacts correspond to the claim being evaluated;
- complete: required components or documented acquisition procedures are present;
- exercisable: the supplied commands/scripts can be invoked in the declared environment;
- verification/validation evidence: controls demonstrate that the harness can distinguish expected PASS, FAIL, BLOCKED and INCONCLUSIVE outcomes.

Passing this documentation quality gate does not mean the candidate result has been reproduced.

## Decision guard

`BENCHMARK_TO_BEAT` and `CHASSIS_WINNER` remain `NOT_SELECTED` until all benchmark-critical mutants satisfy the eligibility rules in `fault-suite.v1.json` with executed, comparable evidence at the evidence class required by the benchmark gate.

A recommendation to select, reject, rank or replace a chassis MUST cite the claim-to-evidence records that support that decision. If the required evidence is absent, the only supported recommendation is to execute or reproduce the missing experiment.
