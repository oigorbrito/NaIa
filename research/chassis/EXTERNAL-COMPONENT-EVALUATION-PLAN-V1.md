# External Component Evaluation Plan V1

Status: PLANNED_NOT_EXECUTED

Purpose: identify the first bounded evaluation series to run under `EXTERNAL-COMPONENT-EVALUATION-PROTOCOL-V1.md` and `EXTERNAL-COMPONENT-EVALUATION-REGISTER-TEMPLATE.md`.

This plan does not select candidates, providers, models, metrics, corpus size, repetition count, or winners in advance.

## Series ECE-DOC-001 — bill/receipt extraction

Research question:

> Which evaluated candidates satisfy the same declared structured extraction contract on the same versioned bill/receipt corpus under their recorded configurations?

Preconditions before execution:

- versioned corpus exists;
- extraction schema exists;
- expected-field source or annotation procedure exists;
- PASS/FAIL/BLOCKED/INCONCLUSIVE semantics are declared;
- candidate identities are pinned or provider identity limitations are recorded;
- candidate-specific adaptations, if any, preserve equivalent task semantics or comparison is marked `INCOMPARABLE`.

No candidate list is frozen by this plan. Open-source components, external models, and a NaIA-native implementation may be evaluated if they can participate under equivalent claim semantics.

## Series ECE-REC-001 — bill/receipt reconciliation

Research question:

> Which evaluated candidates correctly distinguish the declared reconciliation states for the same versioned cases under one acceptance contract?

Preconditions before execution:

- versioned reconciliation cases exist;
- expected state per case is defined;
- allowed evidence fields are declared;
- ambiguity/conflict handling is declared;
- acceptance semantics are fixed before result interpretation;
- candidate identities/configurations are recorded.

The corpus should contain only case classes needed to discriminate the stated claim. There is no universal required case count.

## Series ECE-MODEL-001 — provider-neutral model contract compatibility

Research question:

> Which configured model/provider adapters satisfy the same NaIA provider-neutral request/response contract for the declared task class?

Preconditions before execution:

- provider-neutral request schema exists;
- required capabilities for the task are declared;
- fixed task/corpus identity exists where the claim depends on examples;
- normalized response schema exists;
- acceptance semantics are declared;
- provider/model identity and configuration are captured as precisely as the API permits.

This series tests compatibility with a declared NaIA contract. It does not establish global model intelligence or a permanent provider ranking.

## Cross-series evidence rule

Evidence from one series cannot satisfy another series by default.

```text
ECE-DOC-001 evidence != ECE-REC-001 evidence
ECE-REC-001 evidence != ECE-MODEL-001 evidence
ECE-MODEL-001 evidence != PRODUCT_READINESS evidence
ECE-* evidence != CHASSIS_CANDIDATE_RUNTIME evidence
```

A cross-reference may supply provenance or context only when explicitly labeled.

## Execution readiness

A series is `READY_FOR_EXECUTION` only after its concrete preconditions are versioned and reviewable.

Current state:

```text
ECE-DOC-001 = NOT_READY
ECE-REC-001 = NOT_READY
ECE-MODEL-001 = NOT_READY

REASON = corpus/schema/acceptance/candidate identities not yet frozen for execution
```

This state is not a failure. It records that the evaluation contract has not yet been fully instantiated.
