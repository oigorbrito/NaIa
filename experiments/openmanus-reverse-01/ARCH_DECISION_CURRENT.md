# Current Product Architecture Decision

## Scope

This is a product-MVP architecture decision. It is **not** a `CHASSIS_WINNER` claim and does not replace the repository's research benchmark.

## Repository-defined MVP context

The product baseline defines the implemented path as:

`intent -> actionable plan -> tool selection -> policy -> execution -> evidence -> persisted state/history`

The documented next product block is the extensible capability layer: richer planner contracts, external adapters, scoped policy rules, improved presentation, and eventual durable-execution integration behind existing ports.

Browser/computer-use is not currently documented as a mandatory MVP exit criterion.

Therefore it must not be introduced as a mandatory dependency merely because a candidate framework provides it.

## Decision for the current MVP

**A — NaIA standalone remains the default product architecture.**

Rationale grounded in observed evidence:

- 18/18 baseline product tests pass.
- It preserves all NaIA invariants natively.
- It has the lowest dependency and operational burden.
- Its current score under the frozen architecture protocol is 82/100.
- No currently documented MVP exit criterion requires OpenManus.

## Status of B — NaIA hosts OpenManus

**DEFER / do not adopt for the current MVP.**

Observed positives:
- EXEC-01..06 + SEC-01 pass.
- Two clean reproductions pass.
- No NaIA core changes.
- No OpenManus upstream changes.

Observed cost:
- Node↔Python sidecar.
- Python virtual environment.
- Pinned OpenManus runtime and dependency tree.
- Import isolation work.
- Process startup/runtime overhead.

Current score: 67/100.

This direction does not currently demonstrate enough product value to justify its weight.

## Status of C — OpenManus hosts NaIA authority

**KEEP AS EXPANSION CANDIDATE; DEFER adoption pending LIVE-01.**

Observed positives:
- REV-01..07 pass.
- NaIA policy remains authoritative before browser dispatch.
- Prompt content cannot self-authorize.
- Approval does not transfer to a mutated action.
- No NaIA core changes.
- No OpenManus upstream changes.
- Static source evidence shows browser, MCP, computer-use, shell and crawler capability surfaces absent from the NaIA baseline.

Unresolved:
- LIVE-01 deterministic real-browser task has not yet been observed.

If LIVE-01 passes, C becomes a qualified candidate for the **capability-expansion architecture** of the pocket-secretary product. It still does not become mandatory for the current MVP unless product scope is explicitly changed to require browser/computer-use.

## Practical consequence

Do not block MVP progress on OpenManus.

Continue NaIA product work on its native portable ports.

Keep `experiment/openmanus-reverse-01` as a bounded capability experiment. If the product reaches a user story that genuinely requires browser/computer-use, use the frozen LIVE-01/value protocol to decide whether C should become the operational chassis for that capability.

## Current classification

- Current product MVP: `A / NAIA_STANDALONE`
- B: `DEFER`
- C: `DEFER_PENDING_LIVE_01`, retained as expansion candidate
- `CHASSIS_WINNER`: unchanged / not selected by this experiment
