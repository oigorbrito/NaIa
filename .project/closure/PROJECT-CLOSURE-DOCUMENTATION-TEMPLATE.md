# Project Closure Documentation Template

Status: GENERIC_TEMPLATE
Purpose: reusable documentation-only structure for project closure.

## Activation rule
This template is inert until the user explicitly requests project closure, readiness/release closure, a final checklist, a closure audit, or equivalent assessment. Before instantiating it, the responsible agent must classify it as `VALID_AS_IS`, `NEEDS_ADAPTATION`, or `NOT_APPLICABLE`, and identify concrete project facts that justify any adaptation. Criteria must not be added, removed, or rewritten silently.

## Preserved-repository rule
Do not rewrite historical evidence, retroactively change old results, or mutate preserved artifacts merely to satisfy current checklist criteria. Record any current closure assessment additively and preserve the original revision/context of historical material.

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

## 2. Scope
Record included scope, exclusions, deferred/future work, `CLOSURE_CLAIM`, and `OUT_OF_SCOPE_CLAIMS`.

## 3. Document authority
Identify current, historical, and superseded documents. Confirm one current baseline and no silent authority conflict.

## 4. Requirements and acceptance boundary
For each requirement record applicability, verification/evidence reference, result, and notes.

```text
DOCUMENTED != IMPLEMENTED
IMPLEMENTED != EXECUTED
EXECUTED != ACCEPTED
BLOCKED != FAIL
BLOCKED != PASS
NOT_EXECUTED != PASS
N/A != PASS
```

## 5. Evidence register
Bind claims to exact baseline/version, evidence type, location/reference, and limitations.

## 6. Closure domains
Assess only applicable domains, with evidence and rationale:
1. Baseline and authority
2. Requirements and traceability
3. Verification and validation documentation
4. Empirical evidence and reproducibility
5. Quality and claim boundaries
6. Operational/readiness documentation
7. Repository/documentation convergence

Use `PASS / FAIL / BLOCKED / NOT_EXECUTED / N/A`.

## 7. Exception register
Record failures, blockers, not-executed criteria, N/A rationales, residual risks, and limitations without converting them into PASS.

## 8. Pending work
Classify remaining work as `CLOSURE_BLOCKING / DEFERRED / EXTERNAL / FUTURE_ENHANCEMENT`. Issues/PRs are traceability references only.

## 9. Final closure gates
K1 — Result consolidation integrity: `PASS / FAIL`
K2 — Acceptance-to-evidence consistency: `PASS / FAIL`
K3 — Limitations and residual risk: `PASS / FAIL`
K4 — Pending-work traceability: `PASS / FAIL`
K5 — Decision record completeness: `PASS / FAIL`

## 10. Final decision
Use `APPROVED / APPROVED_WITH_RESERVATIONS / NOT_APPROVED`, with reservations, blockers, residual risks, deferred work, revalidation triggers, authority, and date.

## 11. Invariants
```text
ISSUE_CLOSED != PROJECT_CLOSED
PR_MERGED != PROJECT_CLOSED
DOCUMENTED != IMPLEMENTED
IMPLEMENTED != EXECUTED
EXECUTED != ACCEPTED
BLOCKED != PASS
NOT_EXECUTED != PASS
N/A != PASS
NO_EVIDENCE != PASS
OLD_BASELINE_PASS != CURRENT_BASELINE_PASS
CLAIM_SCOPE <= EVIDENCE_SCOPE
HISTORICAL_EVIDENCE != CURRENT_REVALIDATION
```
