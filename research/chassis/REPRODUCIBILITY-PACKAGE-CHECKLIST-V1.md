# Reproducibility Package Checklist V1

Status: DOCUMENTARY_CONTROL

Purpose: define the minimum documentary/artifact package needed before a chassis result can be represented as repeatable, independently reproducible, or decision-eligible. This checklist does not replace `fault-suite.v1.json` or candidate acceptance rules.

Methodological basis: documented/complete/exercisable artifact criteria, provenance/versioning, repeatability/comparability/verifiability, explicit methods/protocols, environment capture, and preservation of raw observations.

## A. Identity and provenance

Required before any executed result is accepted:

- [ ] repository HEAD SHA recorded;
- [ ] harness SHA recorded;
- [ ] adapter SHA/hash recorded;
- [ ] candidate name and exact version recorded;
- [ ] source revision/tag recorded when applicable;
- [ ] dependency lockfile/integrity identity preserved;
- [ ] server/container/database/CLI versions recorded where material;
- [ ] immutable image digest recorded when a container image is part of the tested system.

Missing material identity means the result is not reproducibly attributable to a defined system version.

## B. Environment manifest

- [ ] OS/version and architecture;
- [ ] runtime version;
- [ ] package-manager version;
- [ ] hardware/topology information material to timing, crash boundary, networking, or persistence semantics;
- [ ] non-secret configuration parameters;
- [ ] names of required secret variables with values redacted;
- [ ] external services and their exact versions;
- [ ] relevant filesystem/database/storage mode.

## C. Procedure

- [ ] exact setup command(s);
- [ ] exact run command(s);
- [ ] exact cleanup/reset command(s);
- [ ] semantic workload declared;
- [ ] input/input-generation procedure declared;
- [ ] fault primitive and injection boundary declared;
- [ ] oracle/measurement mechanism declared;
- [ ] timeout/retry/repetition parameters declared;
- [ ] acceptance checks declared before interpreting the run.

A prose description without executable or directly repeatable commands is insufficient for a `REPEATABLE_LOCAL` or stronger label.

## D. Raw evidence

For each repetition:

- [ ] experiment manifest;
- [ ] environment manifest or immutable reference to it;
- [ ] start/end timestamps;
- [ ] stdout/stderr or structured event stream;
- [ ] external oracle snapshot;
- [ ] fault-injection receipt or proof that the intended boundary was reached;
- [ ] candidate status snapshots as required;
- [ ] process exit/signal record where relevant;
- [ ] cleanup receipt;
- [ ] acceptance-check result;
- [ ] hashes or stable identifiers for preserved artifacts where practical.

Derived summaries do not replace raw evidence.

## E. Repetition completeness

- [ ] required repetition count comes from the frozen experiment contract;
- [ ] every repetition has its own raw record;
- [ ] missing/aborted repetitions are retained and classified rather than silently dropped;
- [ ] fresh objective/operation identity is used when the protocol requires independence;
- [ ] contamination from prior repetitions is checked during cleanup;
- [ ] aggregation links back to all individual records.

## F. Result classification

- [ ] `PASS` only when the intended condition executed and all predeclared acceptance checks passed;
- [ ] `FAIL` only when the intended condition executed and candidate behavior violated an acceptance check;
- [ ] `BLOCKED` when infrastructure/prerequisites prevented candidate measurement;
- [ ] `INCONCLUSIVE` when execution occurred but the intended fault/measurement condition was not established;
- [ ] `PARTIAL` only when explicitly permitted by the frozen experiment contract;
- [ ] `INCOMPARABLE` at comparison level when semantics differ materially.

`NOT_EXECUTED` is a metadata state, not proof of PASS, FAIL, or BLOCKED.

## G. Comparability

Before ranking two candidates:

- [ ] same semantic workload;
- [ ] same measured property;
- [ ] same acceptance-rule meaning;
- [ ] equivalent oracle semantics;
- [ ] equivalent fault/mutant intent;
- [ ] material environment differences disclosed;
- [ ] version differences treated explicitly;
- [ ] no result from a changed experiment contract is mixed into the old series without rerun or explicit `INCOMPARABLE` treatment.

## H. Local repeatability label

`REPEATABLE_LOCAL` may be used only when:

- [ ] sections A–F are complete;
- [ ] required repetitions were executed in the declared local environment;
- [ ] another local rerun using the recorded procedure can be attempted without undocumented manual repair;
- [ ] raw records are retained.

This label does not mean independent reproduction.

## I. Independent reproduction label

`REPRODUCED_INDEPENDENT` additionally requires:

- [ ] a separate environment/person/runner executes the documented procedure;
- [ ] the independent execution identifies its own environment and versions;
- [ ] no private corrective instructions unavailable in the artifact package are needed;
- [ ] independent raw records are preserved;
- [ ] reproduced claims are explicitly identified; unrelated claims are not promoted.

## J. Decision eligibility

`DECISION_ELIGIBLE` requires:

- [ ] all benchmark-critical claims have evidence strength required by the benchmark contract;
- [ ] claim–evidence records exist for every decisive claim;
- [ ] blockers/inconclusive runs are not silently excluded from interpretation;
- [ ] comparison remains semantically valid;
- [ ] no unsupported methodological suggestion is used as a deciding criterion;
- [ ] decision cites exact evidence artifacts rather than only narrative summaries.

If any required decisive claim is missing, keep the benchmark/winner state `NOT_SELECTED` and identify the missing experiment instead of extrapolating.

## K. Documentary change control

Documentation-only edits to wording, inventories, provenance instructions, artifact references, claim-domain boundaries, or terminology do not by themselves invalidate runtime evidence.

Any change to workload, fault boundary, oracle semantics, acceptance meaning, measurement meaning, or version-specific claim MUST be treated as an experiment-contract change and handled through rerun or explicit comparability analysis.

## L. Claim-domain boundary

Before reusing or citing evidence produced elsewhere in the repository:

- [ ] the claim domain answered by the source artifact is identified;
- [ ] the claim domain of the target conclusion is identified;
- [ ] source and target claims are the same, or the relationship is explicitly bounded as contextual/documentary only;
- [ ] exact source revision/procedure identity is retained;
- [ ] a merge, cherry-pick, branch move, or documentary reconciliation is not represented as a fresh runtime execution;
- [ ] evidence strength is not transferred from one claim domain to another;
- [ ] pre-execution infrastructure failure is not converted into system-under-test behavioral failure;
- [ ] product-readiness evidence is not used to satisfy chassis benchmark claims;
- [ ] chassis benchmark/control evidence is not used to redefine product-readiness gates or thresholds.

The repository-local product/chassis application of this rule is documented in `PRODUCT-READINESS-EVIDENCE-BOUNDARY-V1.md`.

This section is a provenance and claim-scope control. It adds no benchmark mutant, product gate, threshold, repetition count, or candidate acceptance criterion.
