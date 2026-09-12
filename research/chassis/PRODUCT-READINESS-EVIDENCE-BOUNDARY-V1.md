# Product Readiness / Chassis Evidence Boundary V1

Status: DOCUMENTARY_CONTROL

Purpose: prevent evidence from the NaIA product-readiness harness from being conflated with evidence from the research chassis benchmark, while preserving exact source identity and the strongest conclusion supported by each artifact.

This document is a methodological/provenance control only. It does not redefine product gates, benchmark mutants, acceptance thresholds, candidate rankings, or implementation architecture.

## Methodological basis

This boundary applies repository-local rules already defined by:

- `EMPIRICAL-HARNESS-METHODOLOGY-V1.md`;
- `METHODOLOGY-SOURCE-MAP-V1.md`;
- `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`;
- `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md`.

The applicable methodological principles are limited to claim-to-evidence traceability, exact system/procedure identity, preservation of raw/derived evidence relationships, separation of infrastructure failure from system-under-test failure, explicit result scope, and prohibition on silently promoting one evidence class into another.

General product, architecture, security, prioritization, or UX preferences are outside this methodological control unless independently adopted as project policy.

## 1. Distinct claim domains

NaIA currently contains at least two evidence-producing domains that must remain distinct:

### Product readiness

Question answered:

> Did the declared NaIA MVP product-readiness gates execute with the recorded result on the exact product candidate revision?

Relevant artifacts include product tests, clean reproductions, external scheduler delivery receipts, provider-event receipts, optional live-provider receipts, and the consolidated product-readiness receipt.

### Research chassis benchmark

Question answered:

> Did a specific chassis candidate satisfy a declared mutant/benchmark claim under the frozen experiment contract, workload, fault boundary, oracle, repetitions, environment, and acceptance rule?

Relevant artifacts include chassis experiment manifests, environment manifests, common-runner evidence, external-oracle observations, fault-injection receipts, cleanup receipts, repetition records, and benchmark claim-evidence records.

These domains are not interchangeable.

```text
PRODUCT_READINESS_PASS != CHASSIS_CANDIDATE_PASS
CHASSIS_CONTROL_PASS != PRODUCT_READINESS_PASS
PRODUCT_REMOTE_CI_BLOCKED != CHASSIS_CANDIDATE_FAIL
CHASSIS_RUNTIME_BLOCKED != PRODUCT_REGRESSION
```

## 2. Current product-readiness identity snapshot

The closed MVP product-readiness evidence supplied by the project is bound to:

```text
candidate commit:
  bd7ebc5bbbc08ae84795a48eb06f35bf46facac9

merge commit:
  f09a28b9b3dfc977080c02712843b771c5cb6be6
```

Recorded core gate state for the candidate revision:

```text
LOCAL_PRODUCT_SUITE          PASS
CLEAN_REPRODUCTION_1         PASS
CLEAN_REPRODUCTION_2         PASS
EXTERNAL_SCHEDULER_DELIVERY  PASS
LIVE_PROVIDER_EVENT          PASS

MVP_CORE_READY               PASS
```

Recorded optional/live and infrastructure state:

```text
LIVE_GCAL_READ               BLOCKED_EXTERNAL_OR_NOT_EXECUTED
REMOTE_CI                    BLOCKED_EXTERNAL / PERSISTENT_PRE_EXECUTION_FAILURE
```

This snapshot records the project claim and its exact revision identity for scope control. The authoritative product artifacts/receipts remain the evidence source for the individual observations.

## 3. Allowed and disallowed conclusions

From the product-readiness evidence above, the harness may preserve the following bounded conclusion:

- the five historical MVP core readiness gates were recorded as `PASS` on the exact candidate revision identified above, and the consolidated product state was recorded as `MVP_CORE_READY=PASS`.

The following conclusions are not licensed by that product-readiness evidence alone:

- any chassis candidate passed a benchmark mutant;
- any chassis candidate is better than another candidate;
- `CHASSIS_WINNER` is selected;
- `BENCHMARK_TO_BEAT` is selected;
- a local/repository product reproduction is an independent chassis reproduction;
- pre-execution remote CI failure is evidence of product or chassis behavioral failure;
- optional Google Calendar live non-execution invalidates the historical five-gate core definition.

Likewise, chassis benchmark evidence does not retroactively modify the historical MVP core gate set or product test threshold.

## 4. Commit-bound evidence rule

A runtime receipt or benchmark execution result is attributable only to the exact source/procedure identity recorded for that execution.

For product readiness:

- a receipt from another source revision is stale for the current candidate;
- a later merge commit does not silently rewrite the identity of evidence produced on its parent candidate revision;
- documentary reconciliation may reference the historical receipt but may not manufacture a fresh runtime execution.

For chassis research:

- candidate, harness, adapter, workload/procedure and environment identities must remain attributable according to the reproducibility checklist;
- a changed experiment contract requires a new series or explicit comparability treatment;
- product-readiness receipts cannot substitute for missing chassis raw records.

## 5. Infrastructure failure classification

Pre-execution infrastructure failure must remain separate from system-under-test behavior.

A remote runner that fails before useful checkout/setup/run steps provides infrastructure/blocker evidence only. It cannot be converted into product FAIL or chassis candidate FAIL unless the failed infrastructure component itself is the predeclared system under test and the observed failure lies inside the declared claim.

Repeated execution of an unchanged, already-observed pre-execution blocker is not required by this methodological document. A rerun becomes methodologically relevant when it is needed to test a changed condition, reproduce a claim under a declared procedure, or resolve an evidence gap that the new execution can actually address.

## 6. Suggestion-admissibility rule for future harness changes

A proposed harness change may be presented as an empirical/reproducibility requirement only when it records all of the following:

```text
observed claim/evidence gap
applicable empirical/reproducibility criterion
methodological source category
why the criterion applies to this study/claim
bounded documentary/instrumentation/procedure change
claim or comparability effect
```

If a field is not applicable to the empirical design, it must not be introduced merely as a generic best-practice checklist item.

Examples of conditional rather than universal fields include baselines, independent variables, repetition counts, statistical analysis, resource measurements, timestamps beyond those needed for the claim, and formal protocol-version labels. Their inclusion must follow from the actual study design, provenance need, or reproducibility risk.

Unsupported engineering preferences remain outside the empirical harness requirement set.

## 7. Claim-domain review procedure

Before a new or historical artifact is used to support a conclusion, complete the following documentary sequence:

1. State the exact claim in `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`.
2. Assign a `claimDomain` before interpreting the artifact.
3. Record the evidence-producing domain for every artifact cited by the claim.
4. Verify exact source/procedure identity for runtime evidence.
5. Check whether the evidence-producing domain matches the claim domain.
6. If evidence crosses domains, record the methodological basis for compatibility; otherwise keep it contextual only.
7. Apply the evidence-strength ladder only inside the supported claim scope.
8. Record disallowed inferences explicitly when there is a known risk of silent promotion.
9. Only then evaluate decision eligibility or comparison consequences.

Minimum compatibility matrix:

| Evidence-producing domain | Directly supports | Does not directly support |
| --- | --- | --- |
| `PRODUCT_READINESS` | exact product-readiness claims | chassis runtime verdict/ranking |
| `HARNESS_VALIDATION` | harness discrimination/validation claims | candidate runtime verdict |
| `CHASSIS_CANDIDATE` | exact candidate/runtime claim | product-readiness state or another candidate |
| `CHASSIS_COMPARISON` | comparison claim after comparability checks | unrelated product or candidate claims |

A cross-domain reference is permitted for provenance, historical context, blocker classification, or explicit methodological comparison, but it does not acquire the target domain's decision authority merely by being cited.

This review is documentary. It does not require rerunning an experiment unless the target claim actually lacks the execution evidence required by its own experiment/reproducibility contract.

## 8. No change to historical gates

This document introduces no new product gate, threshold, mutant, repetition count, candidate requirement, or benchmark ranking rule.

```text
PRODUCT_GATE_SET_CHANGED = NO
PRODUCT_THRESHOLD_CHANGED = NO
CHASSIS_ACCEPTANCE_RULE_CHANGED = NO
CHASSIS_WINNER_SELECTED = NO
BENCHMARK_TO_BEAT_SELECTED = NO
DOCUMENTARY_EVIDENCE_BOUNDARY_ADDED = YES
CLAIM_DOMAIN_REVIEW_PROCEDURE_ADDED = YES
```
