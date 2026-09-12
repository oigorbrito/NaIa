# NaIA Assistant Operating Policy

Status: ACTIVE_PROJECT_INSTRUCTION

Purpose: give every assistant/agent working on NaIA a persistent project-level reminder for capability discovery, empirical filtering, reproducible evaluation, and issue hygiene.

This file is a project instruction. It does not itself create empirical evidence, change product gates, change benchmark thresholds, or select candidates.

## 1. Continuous capability review

When working on NaIA, assistants SHOULD actively look for relevant new capabilities, reusable components, provider APIs, open-source projects, model providers, connectors, and platform features that could materially improve the product or reduce unnecessary implementation work.

Relevant areas include, when applicable:

- external model providers and model-routing infrastructure;
- agents, orchestration and automation;
- Google Drive / Google Photos and equivalent cloud sources;
- WhatsApp-origin media/documents and device storage adapters;
- OCR, document understanding and reconciliation;
- personal archive organization;
- search, memory and retrieval;
- calendar, email and messaging connectors;
- media classification, deduplication and backup awareness;
- cross-platform capability adapters;
- mature reusable open-source projects that may avoid building from zero.

Discovery is not adoption. A candidate remains only a candidate until its relevance and evidence are reviewed.

## 2. Required methodological filter

Even when the user requests or suggests an improvement, assistants MUST distinguish product choice from empirical/reproducibility requirements.

Every proposed methodological or evaluation improvement MUST be classified as exactly one of:

1. `CRITERIO_METODOLOGICO_SUSTENTADO`
   - directly supported by applicable empirical-software-engineering or reproducibility guidance.

2. `DERIVACAO_PARA_VERIFICABILIDADE`
   - not necessarily a literal rule from the literature, but necessary to make an applicable methodological criterion observable, traceable, repeatable or reproducible.

3. `DECISAO_DE_PROJETO`
   - potentially useful product/architecture/engineering choice, but not presented as an empirical/reproducibility requirement.

4. `UNSUPPORTED_SUGGESTION`
   - insufficient basis to promote the suggestion into a methodological requirement.

Do not present ordinary architecture, security, UX, cost, vendor or product preferences as empirical methodology.

## 3. Before recommending implementation from zero

Before proposing a new implementation, assistants SHOULD search for mature or near-complete candidates that could be reused, adapted, integrated through an API, forked, or mined for a bounded capability.

For each serious candidate, record at least:

- repository/product identity;
- exact version/tag/commit when relevant;
- license;
- maintenance/activity state where observable;
- architecture/runtime fit;
- capability fit to the exact NaIA requirement;
- external dependencies and deployment assumptions;
- whether it can remain behind NaIA provider-neutral/cross-platform contracts;
- known evidence vs inferred capability;
- major gaps that NaIA would still need to implement.

Do not equate popularity, stars, marketing claims or source inspection with runtime suitability.

## 4. Test only under a declared evaluation contract

A candidate SHOULD be tested only when the claim to be evaluated is concrete enough to define:

- exact candidate identity as far as available;
- declared task/workload or corpus;
- environment/configuration;
- expected/annotated outcomes or an equivalent oracle;
- acceptance rule fixed before interpreting the candidate result;
- raw evidence to preserve;
- result vocabulary and uncertainty handling;
- comparability conditions when multiple candidates are compared.

Use the repository's external-component evaluation artifacts when applicable:

- `research/chassis/EXTERNAL-COMPONENT-EVALUATION-PROTOCOL-V1.md`
- `research/chassis/EXTERNAL-COMPONENT-EVALUATION-REGISTER-TEMPLATE.md`
- `research/chassis/EXTERNAL-COMPONENT-EVALUATION-PLAN-V1.md`
- `research/chassis/ECE-DOCUMENT-CORPUS-CONTRACT-V1.md`
- `research/chassis/ECE-DOCUMENT-ACCEPTANCE-CONTRACT-V1.md`

Do not invent universal repetition counts, baselines, statistical tests, cost thresholds, latency thresholds or ranking weights. Add them only when the concrete empirical question/design requires them and the methodological basis is recorded.

## 5. Evidence and claim-domain discipline

Before using an artifact to support a conclusion, assistants MUST identify:

- the exact claim;
- `claimDomain`;
- `evidenceProducingDomain`;
- exact source/procedure identity where applicable;
- strongest conclusion the artifact licenses;
- any disallowed inference.

The following promotions remain prohibited unless equivalent claim/procedure evidence actually exists:

```text
PRODUCT_READINESS_PASS != CHASSIS_CANDIDATE_PASS
HARNESS_CONTROL_PASS != CHASSIS_CANDIDATE_PASS
STATIC_VERIFIED != RUNTIME_PASS
REPEATABLE_LOCAL != REPRODUCED_INDEPENDENT
PRE_EXECUTION_INFRA_FAILURE != SYSTEM_UNDER_TEST_FAIL
ECE_* evidence != PRODUCT_READINESS evidence
ECE_* evidence != CHASSIS_CANDIDATE_RUNTIME evidence
```

## 6. Issue workflow

Before creating a GitHub issue:

1. search the current backlog for an existing issue with the same capability or decision surface;
2. update/extend the existing issue when the new work is substantially the same scope;
3. create a new issue only when a real independent gap remains.

A new or materially revised issue SHOULD contain:

- goal;
- bounded scope;
- dependencies;
- acceptance criteria;
- explicit boundary/non-goals;
- source/candidate references when the work is based on external reuse;
- evidence/evaluation dependency when adoption depends on an empirical comparison.

Avoid issue proliferation caused only by vendor names or small implementation variations.

## 7. Capability review cycle

For relevant new functionality, use this sequence:

```text
discover
-> filter for relevance
-> classify methodological status
-> search existing reusable candidates
-> inspect license/maturity/provenance
-> define claim if evaluation is needed
-> define/freeze corpus/workload + acceptance semantics
-> test and preserve raw evidence when ready
-> classify result and limitations
-> update an existing issue or create a new gap issue
-> record what was rejected and why
```

A discovery may stop at any earlier stage when evidence is insufficient or the candidate is irrelevant.

## 8. Product architecture boundary

NaIA Core remains provider-neutral and platform-neutral.

```text
NaIA Core = platform-neutral
Android / iOS / Windows / macOS / Linux / Web = adapters
external AI providers = model adapters
cloud/services = connector adapters
```

External models may provide inference, reasoning, classification, extraction or proposed tool calls, but they do not become authority for external side effects.

The execution chain remains:

```text
intent
-> objective
-> plan
-> policy
-> confirmation / approval
-> execution
-> evidence
```

Changing provider/model MUST NOT bypass approval, authorization, idempotency, connector or evidence semantics.

## 9. Historical controls that must not be casually changed

Unless new observed evidence and an applicable methodology justify a revision, assistants MUST NOT:

- change historical gates or thresholds;
- silently reinterpret historical PASS/FAIL/BLOCKED/INCONCLUSIVE results;
- select `CHASSIS_WINNER` or `BENCHMARK_TO_BEAT` without decision-eligible comparable runtime evidence;
- convert pre-execution infrastructure failure into SUT failure;
- rerun known externally blocked remote CI without an observable infrastructure/configuration change;
- create empty commits merely to trigger webhooks;
- promote documentation-only changes into fresh execution evidence.

## 10. Review output

A capability-review pass SHOULD report:

```text
NEW_RELEVANT_CANDIDATES
EXISTING_ISSUES_UPDATED
NEW_GAP_ISSUES_CREATED
EVALUATIONS_EXECUTED
EVALUATIONS_NOT_READY
CANDIDATES_REJECTED_OR_DEFERRED
METHODOLOGICAL_CLASSIFICATION
EVIDENCE_LIMITATIONS
```

Do not manufacture a recommendation when evidence is incomplete. `NOT_READY`, `BLOCKED`, `INCONCLUSIVE`, `INCOMPARABLE`, or deferral are valid outcomes.
