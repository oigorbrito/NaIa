# ECE Document Acceptance Contract V1

Status: SPECIFIED_NOT_EXECUTED

Purpose: define claim-scoped acceptance semantics for the first NaIA external-component evaluation series without introducing universal thresholds, ranking weights, statistical tests, or repetition counts.

This contract applies only when explicitly referenced by an experiment record. It does not modify product gates or the chassis benchmark.

## 1. General result states

For one declared evaluation case or candidate run, use:

- `PASS`: the declared task executed and all predeclared case-level acceptance checks passed.
- `FAIL`: the declared task executed and at least one predeclared acceptance check failed.
- `BLOCKED`: prerequisites prevented evaluation before the candidate behavior could be measured.
- `INCONCLUSIVE`: execution occurred but required observations were missing or ambiguous enough that PASS/FAIL cannot be supported.
- `INCOMPARABLE`: candidate-specific semantics or procedures differ materially from the comparison contract.

A provider/network/authentication failure before relevant output exists is not a semantic extraction or reconciliation FAIL.

## 2. ECE-DOC-001 extraction acceptance

The research question is limited to conformance with the declared structured extraction contract on the versioned corpus.

Before execution, the experiment record MUST declare:

```text
requiredFields
optionalFields
fieldNormalizationRevision
unknownOrMissingValueRepresentation
candidateOutputSchemaRevision
```

### 2.1 Field-level checks

For an annotated field:

- `EXPECTED_VALUE`: normalized candidate output must equal the normalized expected value under the declared normalization rule.
- `EXPECTED_ABSENT`: candidate output must not invent a substantive value for that field.
- `NOT_APPLICABLE`: field is excluded from acceptance for that document.
- `NOT_ANNOTATED`: field is excluded from acceptance and MUST NOT be counted as correct or incorrect.

A candidate MAY expose confidence, explanation, bounding boxes, or raw OCR, but these do not substitute for the declared field value when the claim concerns structured extraction correctness.

### 2.2 Document-level checks

A document is `PASS` only when every field declared `requiredFields` for that case satisfies its field-level rule.

Optional-field behavior may be preserved as observation without affecting PASS unless the experiment explicitly promotes that field into the acceptance contract before execution.

No aggregate success threshold is defined here. Any later aggregate decision rule must be predeclared for the concrete study and justified by the claim being made.

### 2.3 Hallucinated values

A substantive value returned for an `EXPECTED_ABSENT` required field is a field-level failure for that case.

Free-text explanation that clearly states uncertainty is not itself a structured value unless the normalized output contract maps it into one.

## 3. ECE-REC-001 reconciliation acceptance

The research question is limited to distinguishing declared reconciliation states for the versioned reconciliation cases.

Before execution, declare:

```text
allowedStates
allowedEvidenceFields
stateNormalizationRevision
candidateOutputSchemaRevision
```

### 3.1 Exact state conformance

For conformance-style evaluation, the candidate's normalized state MUST equal the pre-annotated expected state for the case.

Examples:

```text
expected MATCHED + observed MATCHED -> PASS
expected AMBIGUOUS + observed MATCHED -> FAIL
expected UNMATCHED_BILL + observed PROBABLE_MATCH -> FAIL
```

This rule tests state classification only. It does not establish the correctness of an underlying bank settlement unless the corpus ground truth itself validly establishes that fact.

### 3.2 Evidence-basis check

If the experiment claim includes explainable reconciliation, the candidate MUST return or expose the evidence fields required by that declared claim.

A state may therefore fail the declared claim even when the state label matches if the claim explicitly requires traceable evidence and that evidence is absent or incompatible.

If explainability is not part of the declared claim, it MUST NOT be added post hoc as a reason to downgrade a result.

### 3.3 Ambiguity preservation

When corpus ground truth is `AMBIGUOUS`, selecting one plausible candidate as definitively matched fails the state-conformance claim.

Returning `AMBIGUOUS` passes the state-level check when that is the declared expected state.

## 4. Duplicate and identity handling

If the study claim includes logical deduplication, duplicate-source cases and their expected logical identity MUST be declared in the corpus.

A duplicate-handling criterion is not automatically part of extraction or reconciliation acceptance merely because duplicate documents exist.

## 5. Comparability

Candidates are comparable only when they receive semantically equivalent inputs and are judged under the same output meaning and acceptance semantics.

Differences in transport, SDK, provider-specific authentication, or adapter serialization are permitted when they do not change the task semantics.

If one candidate receives OCR text while another receives the original image and that difference can affect the property being compared, the experiment MUST either:

- declare and justify the pipelines as equivalent for the specific claim; or
- treat them as separate series / `INCOMPARABLE`.

## 6. Repetition and stochastic candidates

This contract does not impose a universal repetition count.

If candidate stochasticity, nondeterministic model behavior, timing, or provider variability can materially change the claimed result, the concrete experiment design MUST declare how repeated observations are handled before execution.

A single observed run MUST NOT be generalized into a reliability claim that the design did not test.

## 7. Aggregate reporting

At minimum, preserve per-case outcomes and raw normalized outputs.

Aggregate counts or rates may be computed as derived artifacts, but they MUST link back to all case-level records and MUST NOT hide `BLOCKED`, `INCONCLUSIVE`, or `INCOMPARABLE` cases.

No weighted score, winner threshold, cost-quality tradeoff, or statistical significance criterion is defined by this contract.

## 8. Candidate selection guard

This contract can support statements such as:

> Candidate X satisfied the declared extraction/reconciliation contract on corpus Y under configuration Z.

It does not by itself support:

- “X is the best model overall”;
- “X should permanently replace all other providers”;
- “X is more intelligent”;
- “X is cheaper/faster/better” unless those properties were separately measured under a declared comparable procedure;
- product-release readiness;
- chassis winner selection.

## 9. Execution readiness

`ECE-DOC-001` can move from `NOT_READY` to `READY_FOR_EXECUTION` only when the concrete series record identifies:

```text
corpusId/corpusVersion
candidate identities/configurations
requiredFields
fieldNormalizationRevision
candidateOutputSchemaRevision
procedure/command
raw-output location
```

`ECE-REC-001` additionally requires:

```text
reconciliation case IDs
allowedStates
allowedEvidenceFields
stateNormalizationRevision
```

Readiness means the evaluation contract is instantiated and reviewable. It is not a PASS result.
