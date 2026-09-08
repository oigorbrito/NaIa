# Project Closure Documentation Template

Status: GENERIC_TEMPLATE
Purpose: provide a reusable documentation-only structure for assessing and recording project closure.

This template is intentionally generic. It does not prescribe project-specific implementation work, issue execution, test execution, or architecture changes. It is used to document closure evidence, unresolved items, limitations, residual risk, and the final decision for one exact project baseline.

## Activation rule

This template is inert until a user explicitly requests a project-closure, readiness-closure, final-checklist, or equivalent assessment. Before instantiating it, the responsible agent must review whether the template is still applicable to the current project and state whether it is valid as-is, needs adaptation, or is not applicable. Any proposed change must identify the project fact that justifies it; criteria must not be added or removed silently.

---

## 1. Closure identification

```text
PROJECT:
REPOSITORY:
BASELINE_BRANCH:
BASELINE_SHA:
CLOSURE_SCOPE:
CHECKLIST_VERSION:
ASSESSMENT_DATE:
ASSESSOR:
DECISION_AUTHORITY:
```

---

## 2. Closure scope

### Included in closure
- 

### Explicitly excluded from closure
- 

### Deferred / future work
- 

### Scope boundary
```text
CLOSURE_CLAIM:
OUT_OF_SCOPE_CLAIMS:
```

---

## 3. Document authority

| Document / artifact | Role | Current / Historical / Superseded | Authority notes |
|---|---|---|---|
|  |  |  |  |

- [ ] One current baseline is identified.
- [ ] Current normative documents do not materially contradict one another.
- [ ] Historical/superseded documents cannot silently override current authority.
- [ ] Repository and baseline identity are consistent across closure documents.

---

## 4. Requirements and acceptance boundary

| Requirement / closure criterion | Applicable? | Verification / evidence reference | Result | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

```text
DOCUMENTED != IMPLEMENTED
IMPLEMENTED != EXECUTED
EXECUTED != ACCEPTED
BLOCKED != FAIL
BLOCKED != PASS
NOT_EXECUTED != PASS
N/A != PASS
```

---

## 5. Closure evidence register

| Evidence ID | Claim supported | Exact baseline / version | Evidence type | Location / reference | Limitation |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Evidence should be bound to the exact evaluated baseline whenever applicable.

---

## 6. Documentation closure domains

Use only domains relevant to the project. Mark non-applicable domains explicitly with rationale.

### 6.1 Baseline and authority
- [ ] Canonical baseline exists.
- [ ] Document authority is defined.
- [ ] Repository identity is correct.
- [ ] Historical documents are classified.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.2 Requirements and traceability
- [ ] Closure-relevant requirements are identifiable.
- [ ] Requirements link to evidence or explicit unresolved status.
- [ ] No requirement is silently assumed satisfied.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.3 Verification and validation documentation
- [ ] Verification levels are documented.
- [ ] Evidence strength is not overstated.
- [ ] Simulated, local, integration, external, and operational evidence remain distinguishable where applicable.
- [ ] Missing execution is explicitly recorded.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.4 Empirical evidence and reproducibility
- [ ] Claims are bound to observations/evidence.
- [ ] Exact candidate/version/context is recorded where applicable.
- [ ] Raw observations, analysis, and interpretation are distinguishable where material.
- [ ] Repetitions/variability are documented where material.
- [ ] Limitations and threats to validity are recorded.
- [ ] Missing releasable evidence is explained rather than silently omitted.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.5 Quality and claim boundaries
- [ ] Quality claims have observable support.
- [ ] Unmeasured qualities remain unclaimed.
- [ ] Claim scope does not exceed evidence scope.
- [ ] No arbitrary score substitutes for evidence unless a previously approved project contract explicitly requires one.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.6 Operational/readiness documentation
- [ ] Operational-readiness scope is explicit.
- [ ] Local, hosted, external-system, provider-backed, and production claims are separated where applicable.
- [ ] External infrastructure blockers are not represented as product PASS or FAIL without evidence.
- [ ] Readiness claims identify their exact evidence basis.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

### 6.7 Repository/documentation convergence
- [ ] Current status has one authoritative view.
- [ ] Closure documents agree on project state.
- [ ] Open blockers/deferred work are consolidated.
- [ ] Issue/PR state is used only as supporting traceability, not as proof of project closure by itself.
Result: `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`

---

## 7. Exception register

### Failures
| ID | Criterion | Evidence | Closure impact | Disposition |
|---|---|---|---|---|
|  |  |  |  |  |

### Blockers
| ID | Blocker | Internal / External | Evidence | Closure impact | Exit condition |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

### Not executed
| ID | Criterion | Reason | Available evidence | Closure impact |
|---|---|---|---|---|
|  |  |  |  |  |

### N/A decisions
| ID | Criterion | Rationale | Supporting authority |
|---|---|---|---|
|  |  |  |  |

### Residual risks / limitations
| ID | Risk or limitation | Evidence basis | Accepted / Deferred / Blocking | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

---

## 8. Pending work classification

| Item | Classification | Required for closure? | Reference | Notes |
|---|---|---|---|---|
|  | CLOSURE_BLOCKING / DEFERRED / EXTERNAL / FUTURE_ENHANCEMENT |  |  |  |

Issue execution is outside this document. Issues and PRs may be referenced only to preserve traceability.

---

## 9. Final closure gates

K1 — Result consolidation integrity: `PASS / FAIL`
K2 — Acceptance-to-evidence consistency: `PASS / FAIL`
K3 — Limitations and residual risk: `PASS / FAIL`
K4 — Pending-work traceability: `PASS / FAIL`
K5 — Decision record completeness: `PASS / FAIL`

---

## 10. Final decision record

```text
PROJECT:
REPOSITORY:
BASELINE_BRANCH:
BASELINE_SHA:
CHECKLIST_VERSION:
ASSESSMENT_DATE:

K1_RESULT:
K2_RESULT:
K3_RESULT:
K4_RESULT:
K5_RESULT:

FINAL_DECISION: APPROVED | APPROVED_WITH_RESERVATIONS | NOT_APPROVED

RESERVATIONS:
BLOCKERS:
RESIDUAL_RISKS:
DEFERRED_WORK:
REVALIDATION_TRIGGERS:

DECISION_AUTHORITY:
DECISION_DATE:
```

---

## 11. Closure invariants

```text
ISSUE_CLOSED != PROJECT_CLOSED
PR_MERGED != PROJECT_CLOSED
DOCUMENTED != IMPLEMENTED
IMPLEMENTED != EXECUTED
EXECUTED != ACCEPTED
BLOCKED != FAIL
BLOCKED != PASS
NOT_EXECUTED != PASS
N/A != PASS
NO_EVIDENCE != PASS
OLD_BASELINE_PASS != CURRENT_BASELINE_PASS
CLAIM_SCOPE <= EVIDENCE_SCOPE
```

This template is complete when it can support an auditable closure decision for one exact project baseline without requiring the reader to infer missing evidence or execution.