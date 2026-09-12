# External Component Evaluation Protocol V1

Status: SPECIFIED_NOT_EXECUTED

Purpose: define a reproducible, claim-scoped protocol for evaluating external components that NaIA may reuse or route through, including model providers, OCR/document-processing components, reconciliation engines, storage/connectivity adapters, and similar dependencies.

This protocol is derived from the repository-local methodological controls in `EMPIRICAL-HARNESS-METHODOLOGY-V1.md`, `METHODOLOGY-SOURCE-MAP-V1.md`, `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`, and `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md`.

It introduces no universal benchmark, mandatory baseline, fixed repetition count, mandatory statistical test, cost threshold, latency threshold, or product-selection rule. Such elements are included only when required by the concrete empirical claim being evaluated.

## 1. Evaluation question first

An evaluation MUST begin with a bounded claim.

Examples:

```text
Can component X extract the declared bill fields from the fixed evaluation corpus under the stated configuration?

Can model/provider X satisfy the same structured-output contract as model/provider Y on the same document-reconciliation tasks?

Can component X produce the required source-provenance fields needed by NaIA's document pipeline?
```

A component SHALL NOT be labeled generically "better", "more capable", "production-ready", or "preferred" unless the evaluation contract defines the claim and observations that license that conclusion.

## 2. Claim domain

Each record MUST declare:

- `claimId`;
- `claimDomain`;
- component/candidate identity;
- exact version, model identifier, tag, commit, image digest, API version or equivalent identity where observable;
- evaluation-series identity;
- claim text;
- explicit exclusions.

Recommended domain for this protocol:

```text
EXTERNAL_COMPONENT_EVALUATION
```

Evidence from this domain does not become `CHASSIS_CANDIDATE_RUNTIME`, `PRODUCT_READINESS`, or another domain merely because the evaluated component is later used by NaIA.

## 3. Fixed task/workload identity

Compared candidates MUST receive equivalent task semantics.

For each evaluation series, record or version:

- input corpus or input-generation procedure;
- task definitions;
- required input preprocessing;
- prompt/template/schema when a model is evaluated;
- tool/function definitions when applicable;
- expected output schema or observable property;
- acceptance checks;
- known exclusions or unsupported cases.

If candidate-specific adaptation is necessary, record the adaptation and justify why the semantic task remains equivalent. If equivalence cannot be established, classify the cross-candidate comparison as `INCOMPARABLE`.

## 4. Corpus requirements

A fixed corpus is required only when the empirical claim depends on processing representative input examples.

When used, the corpus package MUST record:

- corpus identity/version;
- item identifiers;
- source/provenance or generation method;
- ground-truth or expected-observation source where applicable;
- transformations/redactions applied before evaluation;
- train/test contamination risk when relevant to the claim;
- exact subset used by each run.

For bill/receipt reconciliation, a claim-discriminating corpus SHOULD include cases sufficient to exercise the stated claim, for example exact matches, conflicting amounts, multiple plausible receipts, missing receipts, or extraction failures. These cases are justified only when they are needed to distinguish the declared result states.

The protocol does not prescribe a universal corpus size.

## 5. Candidate identity and configuration

For every evaluated candidate, record as applicable:

- repository/tag/commit;
- package/library version;
- model/provider/model identifier returned by the provider when observable;
- API version/endpoint family;
- runtime/dependency versions;
- non-secret configuration;
- sampling/decoding parameters when they are material to the claim;
- enabled tools/capabilities;
- local hardware/runtime identity when material to the result.

Secret values MUST NOT be persisted in evidence.

Aliases that can move over time are insufficient by themselves when the provider exposes a more specific execution identity. When an exact immutable model revision is not observable, record that limitation explicitly.

## 6. Acceptance semantics

Acceptance checks MUST be declared before the candidate result is interpreted.

The check may be exact or tolerance-based depending on the claim, but it must state what observable result constitutes:

- `PASS`;
- `FAIL`;
- `BLOCKED`;
- `INCONCLUSIVE`;
- `INCOMPARABLE` at the comparison layer where applicable.

Examples for document extraction may include schema validity and agreement with declared expected fields. Examples for reconciliation may include correct `MATCHED`, `AMBIGUOUS`, or `UNMATCHED` classification under the fixed cases.

A changed acceptance meaning starts a new evaluation series or requires explicit comparability treatment.

## 7. Execution record

For each run preserve:

- candidate identity;
- evaluation-series identity;
- task/corpus subset identity;
- exact invocation/request configuration;
- environment/provider endpoint identity where material;
- raw candidate response/output;
- normalized output used by the acceptance check;
- acceptance-check result;
- provider/runtime error if any;
- timestamps only where needed for provenance, availability, latency, or another declared claim;
- derived summary linked back to raw observations.

Provider outage, quota exhaustion, authentication failure, or unavailable dependency is infrastructure/provider evidence and MUST NOT be silently converted into candidate behavioral `FAIL` unless availability itself is the predeclared property under test.

## 8. Repetition

Repetition is conditional on the study design.

A single run may be sufficient for a deterministic static/schema/property check when the measured property is deterministic under the recorded conditions.

Repeated executions are required when nondeterminism, stochastic sampling, provider variability, concurrency, race behavior, or another run-to-run factor is material to the claim.

The number of repetitions MUST follow from the concrete claim and evaluation design; this protocol does not prescribe a universal count.

Each repeated run retains its own raw record. Aggregation must not erase individual failures, blockers, or inconclusive observations.

## 9. Comparison rule

A candidate comparison is eligible only when the compared runs preserve equivalent:

- claim;
- semantic task/workload;
- input/corpus subset;
- output/measurement meaning;
- acceptance rule.

Candidate-native implementation or provider mechanisms may differ.

Cost, latency, token usage, memory, energy, or other resource properties are comparison dimensions only when the evaluation question explicitly includes them and the capture procedure is defined for all compared candidates.

Do not rank candidates using a property that was not part of the declared evaluation claim.

## 10. Decision rule

Evaluation evidence can support only the bounded decision declared by the claim.

Examples:

```text
SUPPORTED:
component X satisfies the declared extraction contract on corpus/version C under configuration K

NOT SUPPORTED:
component X is the best document engine for NaIA
```

```text
SUPPORTED:
model A and model B are comparable for the declared reconciliation task and A passed more predeclared cases in this series

NOT SUPPORTED:
model A is globally more intelligent
```

Adoption, licensing, architecture, vendor strategy, privacy policy, user experience, and commercial considerations may separately affect a product decision. They MUST NOT be mislabeled as conclusions of this empirical evaluation unless they were themselves measured under a declared study design.

## 11. NaIA reuse-vs-build application

Before implementing a substantial external capability from scratch, NaIA MAY use this protocol to evaluate reusable candidates such as document-management, OCR, extraction, reconciliation, connector, or model components.

The methodologically supported sequence is:

```text
bounded claim
-> candidate identities
-> fixed/equivalent task
-> predeclared acceptance semantics
-> raw evidence
-> claim-scoped result
-> bounded reuse/adoption decision
```

This sequence is a reproducibility/traceability control. It does not mandate that NaIA reuse third-party software, nor does it prohibit a bespoke implementation.

## 12. Suggested initial evaluation series

These are evaluation targets, not pre-decided product requirements:

### ECE-DOC-001 — bill/receipt extraction

Question:

> Which candidate components satisfy NaIA's declared structured extraction contract on the same versioned bill/receipt corpus?

Potential candidates may include reusable open-source components and configured external models.

Required before execution:

- corpus/version;
- extraction schema;
- expected-field source;
- acceptance rule;
- candidate/version identities.

### ECE-REC-001 — bill/receipt reconciliation

Question:

> Which candidate components correctly distinguish the declared exact-match, ambiguous, conflicting, and unmatched cases under one reconciliation contract?

Required before execution:

- reconciliation-case corpus/version;
- expected state for each case;
- allowed evidence fields;
- acceptance rule;
- candidate identities.

### ECE-MODEL-001 — provider-neutral model compatibility

Question:

> Which configured model/provider adapters satisfy the same NaIA model request/response contract for a declared task class?

Required before execution:

- provider-neutral request schema;
- task/corpus identity;
- required capabilities;
- normalized output schema;
- acceptance rule;
- provider/model identities.

No execution or winner is implied by defining these series.

## 13. Current state

```text
EXTERNAL_COMPONENT_PROTOCOL_SPECIFIED = YES
EXTERNAL_COMPONENT_EVALUATION_EXECUTED = NO
COMPONENT_WINNER_SELECTED = NO
MODEL_WINNER_SELECTED = NO
UNIVERSAL_METRIC_SET_DEFINED = NO
UNIVERSAL_REPETITION_COUNT_DEFINED = NO
```
