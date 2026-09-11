# Methodology Source Map V1

Status: DOCUMENTARY_CONTROL

Purpose: make every harness-methodology requirement auditable to a named empirical/reproducibility source category. This file is not evidence that any candidate experiment has executed.

## Source set

### ACM Artifact Review / reproducibility guidance

Harness-relevant concepts used here:

- artifacts should be documented, consistent, complete and exercisable;
- verification/validation evidence should accompany functional artifacts;
- reusable artifacts require documentation and structure beyond minimal functionality;
- independently reproduced results are a different claim from artifact functionality or availability;
- artifact packages should identify environment/dependencies and provide executable instructions/scripts.

### NIST TN 1830 — software performance measurement rigor

Harness-relevant concepts used here:

- measurements and reporting should support repeatability, comparability and verifiability;
- the measured property and measurement procedure must be stated clearly enough to avoid misleading conclusions;
- environmental and methodological factors that can affect the result must be controlled or reported.

### NIST Research Data Framework (RDaF)

Harness-relevant concepts used here:

- provenance;
- specification and parameters of instruments/tools;
- methods/protocols;
- data/metadata capture methods;
- hardware/software computational conditions;
- versioning;
- input/output metadata;
- reproducibility without requiring undisclosed corrective communication from the original investigator.

### Zelkowitz & Wallace — experimental validation in software engineering

Harness-relevant concepts used here:

- distinguish empirical validation from assertion or anecdote;
- define the experimental method and observations supporting a software-engineering claim;
- avoid promoting unexecuted designs or demonstrations into stronger empirical conclusions.

## Rule mapping

| Harness rule | Source basis | Required artifact/behavior |
| --- | --- | --- |
| Distinguish observed, inferred and not executed | empirical validation + reproducibility guidance | explicit result state and raw evidence reference |
| Pin candidate/harness/adapter versions | RDaF provenance/versioning; ACM completeness | SHA/tag/package/image identities |
| Record runtime/environment/tool parameters | RDaF computational conditions; NIST measurement rigor | environment manifest |
| Preserve raw observations | RDaF capture/provenance; ACM verification evidence | raw logs/oracle snapshots/receipts |
| Setup/run/cleanup procedure must be executable | ACM documented/complete/exercisable criteria | runbook + commands/scripts + cleanup record |
| Separate infrastructure failure from candidate failure | empirical validity; NIST measurement interpretation | BLOCKED/INCONCLUSIVE vs candidate FAIL |
| Repeat scheduling/race/failure-injection experiments | measurement repeatability and verifiability | per-repetition raw records + aggregation |
| Keep workload/acceptance semantics comparable | NIST comparability | frozen experiment contract or new experiment series |
| Distinguish local repeatability from independent reproduction | ACM result-reproduction distinction; RDaF reproducibility | separate evidence-class label and independent receipt |
| Trace decisions to claims and observations | RDaF provenance; empirical validation | claim-to-evidence record |
| Do not recommend a chassis winner without required evidence | empirical validation | benchmark decision guard |
| Do not label unsupported preference as methodology | scope discipline derived from the source set | `UNSUPPORTED_SUGGESTION` until source/measurement mapping exists |

## Suggestion admissibility template

Any proposed harness improvement presented as an empirical/reproducibility requirement must contain:

```text
Suggestion ID:
Claim/risk addressed:
Source category:
Observed gap or reproducibility failure mode:
Artifact/measurement added or strengthened:
Does it change workload/acceptance semantics? yes/no
Required re-execution if semantics change:
Decision impact:
```

If these fields cannot be completed from the source set and the current harness evidence, the suggestion may still be an engineering idea, but it SHALL NOT be described as a methodological requirement.

## Evidence-strength ladder

Use this ladder only as a labeling discipline; it does not replace the benchmark rules in `fault-suite.v1.json`.

```text
DOCUMENTED
  -> STATIC_VERIFIED
  -> REPEATABLE_LOCAL
  -> REPRODUCED_INDEPENDENT
  -> DECISION_ELIGIBLE
```

A higher label requires its own artifact. No level is inferred from the previous level alone.

## Change-control rule

Documentation-only changes that improve inventory, provenance, procedures, artifact references or terminology do not by themselves invalidate prior runtime evidence.

Changes to any of the following are experiment-contract changes and require explicit comparability treatment:

- semantic workload;
- fault primitive or injection boundary;
- acceptance rule;
- external oracle semantics;
- measurement meaning;
- candidate version when the claim is version-specific.

When such a change occurs, either rerun all compared candidates under the revised contract or classify cross-series comparison as `INCOMPARABLE`.
