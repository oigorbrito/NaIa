# Claim–Evidence Register Template

Status: DOCUMENTARY_CONTROL

Purpose: provide a repeatable, auditable record connecting an empirical claim to the exact procedure, observations, artifacts, acceptance checks, and decision it supports. This template does not create evidence by itself.

Methodological basis: empirical-validation discipline, artifact/reproducibility guidance, provenance/versioning, repeatability/comparability/verifiability, and explicit separation of observed results from inference.

## Record identity

- `claimId`:
- `experimentSeriesId`:
- `candidateId`:
- `candidateVersion`:
- `candidateSourceRevision`:
- `adapterRevision`:
- `harnessRevision`:
- `recordedAt`:
- `recordedBy`:

## Claim

- **Claim text:**
- **Claim class:** one of `DOCUMENTED`, `STATIC_VERIFIED`, `REPEATABLE_LOCAL`, `REPRODUCED_INDEPENDENT`, `DECISION_ELIGIBLE`.
- **Scope:** exact candidate/version/topology/workload/fault boundary to which the claim applies.
- **Exclusions:** what the claim explicitly does not establish.

A claim MUST NOT be broader than the evidence series that supports it.

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

## Decision

- **Decision supported:**
- **Decision not supported:**
- **Next missing evidence, if any:**
- **Does this record make the candidate decision-eligible?** yes/no

A recommendation to select, reject, rank, or replace a candidate MUST cite one or more completed claim–evidence records whose evidence class is sufficient for that decision.

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
