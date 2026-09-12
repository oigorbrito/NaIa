# External Component Evaluation Register Template

Status: DOCUMENTARY_CONTROL

Purpose: instantiate `EXTERNAL-COMPONENT-EVALUATION-PROTOCOL-V1.md` for one external-component evaluation claim without silently promoting the result into product readiness, chassis qualification, or a global component ranking.

## Record identity

- `claimId`:
- `claimDomain`: `EXTERNAL_COMPONENT_EVALUATION`
- `evaluationSeriesId`:
- `recordedAt`:
- `recordedBy`:

## Claim

- **Claim text:**
- **Decision this claim may support:**
- **Explicit exclusions:**

## Candidate identity

- **Candidate/component:**
- **Provider/project:**
- **Version/model/tag/commit/API identity:**
- **Mutable alias present:** yes/no
- **More specific immutable identity observable:** yes/no
- **Identity limitation:**

## Task/workload identity

- **Task class:**
- **Corpus/input version:**
- **Exact subset:**
- **Prompt/template/schema version if applicable:**
- **Preprocessing:**
- **Candidate-specific adaptation:**
- **Why task semantics remain equivalent:**

## Acceptance semantics

- **Measured property:**
- **PASS rule:**
- **FAIL rule:**
- **BLOCKED rule:**
- **INCONCLUSIVE rule:**
- **Comparison `INCOMPARABLE` rule:**

## Configuration and environment

Record only fields material to the claim:

- runtime/dependency identity:
- endpoint/API family:
- non-secret parameters:
- enabled capabilities/tools:
- sampling/nondeterminism controls where applicable:
- relevant hardware/topology:

## Raw evidence

- raw request/input reference:
- raw response/output reference:
- normalized output reference:
- acceptance-check artifact:
- provider/runtime error artifact:
- derived summary:
- hashes/identities where available:

## Repetition applicability

- **Is run-to-run variability material to this claim?** yes/no
- **If yes, why:**
- **Repetition design/count justification:**
- **Completed repetitions:**
- **All raw repetitions preserved:** yes/no/not-applicable

No repetition count is implied by this template.

## Observation

- **Execution status:** `EXECUTED`, `BLOCKED`, `INCONCLUSIVE`, or `NOT_EXECUTED`
- **Observed result:**
- **Acceptance checks passed/failed:**
- **Deviations:**
- **Missing observations:**
- **Infrastructure/provider failures:**

## Comparability

Complete when more than one candidate is compared:

- same claim: yes/no
- equivalent semantic task/workload: yes/no
- same corpus/subset: yes/no
- same measurement meaning: yes/no
- same acceptance semantics: yes/no
- material differences:
- comparison status: `COMPARABLE` / `INCOMPARABLE`

## Result

- **Verdict:** `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`, or `INCOMPARABLE`
- **Evidence-strength label actually earned:**
- **Strongest supported conclusion:**
- **Conclusion not supported:**

## Product-decision boundary

- **May this result inform reuse/build/provider selection?** yes/no
- **What bounded decision can it inform?**
- **Unmeasured considerations that remain separate (e.g. licensing, privacy, commercial policy, architecture):**

A product decision may use this evidence, but the decision is not itself an empirical result unless its additional criteria were measured under a declared evaluation design.
