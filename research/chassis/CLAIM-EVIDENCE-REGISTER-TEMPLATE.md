# Claim–Evidence Register Template

Status: DOCUMENTARY_CONTROL

Purpose: provide a repeatable, auditable record connecting an empirical claim to the exact procedure, observations, artifacts, acceptance checks, and decision it supports. This template does not create evidence by itself.

Methodological basis: empirical-validation discipline, artifact/reproducibility guidance, provenance/versioning, repeatability/comparability/verifiability, explicit separation of observed results from inference, and claim-domain isolation as defined by `PRODUCT-READINESS-EVIDENCE-BOUNDARY-V1.md`.

## Record identity

- `claimId`:
- `claimDomain`: one of `PRODUCT_READINESS`, `HARNESS_VALIDATION`, `CHASSIS_CANDIDATE`, `CHASSIS_COMPARISON`, or another explicitly documented domain justified by the applicable study design.
- `experimentSeriesId`:
- `candidateId`:
- `candidateVersion`:
- `candidateSourceRevision`:
- `adapterRevision`:
- `harnessRevision`:
- `recordedAt`:
- `recordedBy`:

`claimDomain` is mandatory for any record used to support a runtime or decision claim. Documentary records that do not fit an experiment series must still declare the domain whose conclusion they constrain.

## Claim

- **Claim text:**
- **Claim class:** one of `DOCUMENTED`, `STATIC_VERIFIED`, `REPEATABLE_LOCAL`, `REPRODUCED_INDEPENDENT`, `DECISION_ELIGIBLE`.
- **Scope:** exact candidate/version/topology/workload/fault boundary to which the claim applies.
- **Exclusions:** what the claim explicitly does not establish.

A claim MUST NOT be broader than the evidence series that supports it.

A record MUST NOT use evidence from another claim domain to increase its evidence-strength label or to satisfy a missing acceptance condition unless a documented methodological argument establishes that the evidence measures the same claim under an equivalent procedure. Mere repository co-location, shared commit ancestry, or shared tooling is insufficient.

## Claim-domain compatibility

Before interpreting the evidence, record:

- **Evidence-producing domain(s):**
- **Same domain as `claimDomain`:** yes/no
- **Cross-domain evidence used:** yes/no
- **If yes, methodological basis for compatibility:**
- **Does cross-domain evidence change evidence strength:** yes/no
- **Disallowed inference explicitly checked:**

Default rule:

```text
PRODUCT_READINESS evidence -> PRODUCT_READINESS claims only
HARNESS_VALIDATION evidence -> HARNESS_VALIDATION claims only
CHASSIS_CANDIDATE evidence -> exact candidate/runtime claim only
CHASSIS_COMPARISON evidence -> comparison claim only when comparability rules pass
```

Cross-domain evidence may provide context, provenance, or a blocker classification, but it does not inherit decision authority by default.

Examples of prohibited silent promotion include:

```text
PRODUCT_READINESS_PASS -> CHASSIS_CANDIDATE_PASS
HARNESS_CONTROL_PASS -> CHASSIS_CANDIDATE_PASS
STATIC_VERIFIED -> RUNTIME_PASS
REPEATABLE_LOCAL -> REPRODUCED_INDEPENDENT
PRE_EXEC_INFRA_FAILURE -> SYSTEM_UNDER_TEST_FAIL
```

If domain compatibility cannot be established, retain the evidence as contextual/documentary and record the target claim as unsupported by that artifact.

## Hypothesis and acceptance rule

- **Hypothesis:**
- **Null/competing explanation considered:**
- **Measured property:**
- **Acceptance checks declared before execution:**
- **Failure condition:**
- **Blocked/inconclusive conditions:**

Acceptance checks changed after observing results MUST be recorded as a new experiment series or explicitly marked as post-hoc analysis; they do not retroactively define PASS for the original series.

## Procedure

- **Runbook section/version:**
- **Exact command or script:**
- **Input/workload identity:**
- **Fault primitive and trigger:**
- **Oracle/measurement mechanism:**
- **Repetition count required:**
- **Cleanup/reset procedure:**

## Environment and provenance

Record or link to an environment manifest containing, as applicable:

- OS and architecture;
- runtime/package-manager versions;
- dependency lock/integrity identity;
- service/server/container/database versions;
- immutable image digests where used;
- non-secret configuration parameters;
- names of required secret variables, never secret values;
- hardware or topology details material to the claim.

## Raw artifacts

List exact paths/identifiers and hashes where available:

- experiment manifest:
- environment manifest:
- stdout/stderr or structured logs:
- oracle snapshot:
- fault-injection receipt:
- status snapshots:
- cleanup receipt:
- per-repetition records:
- aggregate/derived output:

Derived summaries MUST retain references to the underlying raw records.

## Observation

- **Execution status:** `EXECUTED`, `BLOCKED`, `INCONCLUSIVE`, or `NOT_EXECUTED`.
- **Observed result:**
- **Observed deviations from planned procedure:**
- **Infrastructure failures:**
- **Candidate behavior failures:**
- **Missing observations:**

Infrastructure failure MUST NOT be relabeled as candidate failure unless candidate behavior was actually measured under the intended condition.

## Repetition and reproduction

- **Local repetitions completed / required:**
- **All raw repetition records preserved:** yes/no
- **Independent reproduction performed:** yes/no
- **Independent environment/person/runner identity:**
- **Independent reproduction artifact:**

Local repeatability and independent reproduction are separate evidence claims.

## Comparability

- **Compared against:**
- **Same semantic workload:** yes/no
- **Same acceptance meaning:** yes/no
- **Equivalent oracle semantics:** yes/no
- **Equivalent mutant/fault intent:** yes/no
- **Material differences:**

If any material semantic difference prevents valid comparison, classify the comparison layer as `INCOMPARABLE` rather than manufacturing a rank.

## Result

- **Verdict:** `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`, `PARTIAL`, or `INCOMPARABLE` where applicable.
- **Evidence-strength label actually earned:**
- **Acceptance checks passed/failed:**
- **Reasoning limited to observed artifacts:**
- **Claim-domain compatibility satisfied:** yes/no

A `no` domain-compatibility result prevents the incompatible artifact from supporting the target claim, even if the artifact is valid evidence for a different claim domain.

## Decision

- **Decision supported:**
- **Decision not supported:**
- **Next missing evidence, if any:**
- **Does this record make the candidate decision-eligible?** yes/no

A recommendation to select, reject, rank, or replace a candidate MUST cite one or more completed claim–evidence records whose evidence class is sufficient for that decision and whose claim domain is compatible with the decision being made.

## Suggestion admissibility

For any proposed harness change justified as an empirical/reproducibility requirement, record:

- suggestion ID;
- claim/risk addressed;
- source category from `METHODOLOGY-SOURCE-MAP-V1.md`;
- observed gap or reproducibility failure mode;
- artifact/measurement strengthened;
- whether experiment semantics change;
- required rerun/comparability action.

If this mapping cannot be completed, label the idea `UNSUPPORTED_SUGGESTION` rather than a methodological requirement.
