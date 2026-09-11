# NaIA MVP Architecture Scorecard

Protocol: `ARCH_DECISION_PROTOCOL.md`

Scores use only evidence available before LIVE-01.

## A — NaIA standalone

- Product capability coverage: 2/5 → 12/30
  - Strong control/product semantics, but no browser/computer-use/sandbox baseline capability.
- NaIA invariant preservation: 5/5 → 25/25
  - Native baseline; 18/18 regressions.
- Integration/maintenance burden: 5/5 → 20/20
  - No external chassis integration.
- Reproducibility/operability: 5/5 → 15/15
  - Baseline repeatedly passes locally.
- Runtime/dependency weight: 5/5 → 10/10
  - Small Node-only product surface.

Observed subtotal: **82/100**

Interpretation: eligible as the smallest architecture, but capability coverage is currently below pocket-secretary target if browser/computer-use is part of MVP scope.

## B — NaIA hosts OpenManus

- Product capability coverage: 3/5 → 18/30
  - OpenManus execution primitives are integrated; differentiated browser value not yet live-validated through this direction.
- NaIA invariant preservation: 5/5 → 25/25
  - EXEC contract passes; approval boundary preserved; core untouched.
- Integration/maintenance burden: 2/5 → 8/20
  - Node↔Python sidecar, venv, pinned runtime, import isolation and dependency tree required.
- Reproducibility/operability: 4/5 → 12/15
  - Two clean reproductions pass after harness corrections.
- Runtime/dependency weight: 2/5 → 4/10
  - Python process startup and large dependency surface observed.

Observed subtotal: **67/100**

Interpretation: execution compatibility is proven, but current evidence does not justify adoption for MVP.

## C — OpenManus hosts NaIA authority

- Product capability coverage: PENDING LIVE-01
  - Static evidence shows Browser Use MCP, computer-use, shell, crawler and MCP infrastructure, but operational value requires live task.
- NaIA invariant preservation: 5/5 → 25/25
  - REV-01..07 pass; side effects remain behind NaIA authority.
- Integration/maintenance burden: 3/5 → 12/20
  - Reverse gateway is small and no core/upstream changes are required, but runtime still includes OpenManus/Browser Use ecosystem.
- Reproducibility/operability: 3/5 → 9/15
  - Authority suite is reproducible; live browser still pending.
- Runtime/dependency weight: 2/5 → 4/10
  - Heavy external runtime remains.

Known subtotal excluding capability: **50/70**

If LIVE-01 passes, capability score will be assigned from observed coverage only.
If LIVE-01 is blocked externally, final status remains DEFER.

## Current decision before LIVE-01

- A: ELIGIBLE, 82/100, smallest proven architecture.
- B: DEFER, 67/100.
- C: DEFER pending LIVE-01.

No OpenManus architecture is adopted yet.
