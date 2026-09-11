# Architecture Decision Protocol — NaIA MVP

## Question

Which architecture should carry the pocket-secretary MVP?

- A — NaIA standalone
- B — NaIA hosts OpenManus as execution chassis
- C — OpenManus hosts NaIA authority/product layer

This protocol is frozen before observing the live-browser result.

## Non-negotiable gates

Any architecture is ineligible if it violates one of these:

1. NaIA approval remains authoritative for side effects.
2. Unknown actions fail closed.
3. Idempotency semantics are preserved.
4. Evidence/persistence sanitization remains intact.
5. Restart/resume does not duplicate irreversible actions.
6. No required semantic modification of upstream OpenManus.

## Weighted criteria

Weights are fixed before live-browser evidence:

- Product capability coverage for pocket-secretary MVP: 30
- NaIA invariant preservation: 25
- Integration/maintenance burden: 20
- Reproducibility/operability: 15
- Runtime overhead / dependency weight: 10

Score each criterion from 0 to 5. Weighted score = score / 5 * weight.

## Evidence rules

Observed execution evidence outranks static source inspection.

Static source inspection may establish that a capability exists but cannot establish that it is operational in the NaIA integration.

A capability counts as operational only after an executable test passes under the declared architecture.

Missing evidence is not scored as success.

## Current evidence entering this protocol

### A — NaIA standalone

Observed:
- 18/18 product regression tests pass.
- Approval, idempotency, persistence safety, trigger/scheduler, restart/resume are implemented.
- Local tool catalog currently includes time.now, text.uppercase, text.echo, note.write.

Not observed / not implemented at baseline:
- Browser automation.
- Computer-use GUI automation.
- General shell/sandbox execution.

### B — NaIA hosts OpenManus

Observed:
- EXEC-01..06 + SEC-01 pass.
- Two clean reproductions pass.
- NaIA core modifications = 0.
- OpenManus upstream modifications = 0.

Constraint observed:
- Node↔Python sidecar, virtual environment and OpenManus dependency tree are required.

### C — OpenManus hosts NaIA authority

Observed:
- REV-01..07 pass.
- NaIA authority can block/permit browser proposals before dispatch.
- Prompt-like content cannot self-authorize.
- Mutation of an approved action does not inherit approval.
- NaIA core modifications = 0.
- OpenManus upstream modifications = 0.

Pending:
- Deterministic LIVE-01 browser task through the gateway.

## Decision rule

ADOPT_FOR_MVP requires:

- all non-negotiable gates PASS;
- live execution evidence for the capability that materially differentiates the architecture;
- weighted score >= 75/100;
- no competing eligible architecture scores >= 10 points higher.

If the differentiated capability is not live-validated, return DEFER.

If live validation fails because of external prerequisites, return DEFER, not REJECT.

If invariants fail, return REJECT regardless of weighted score.
