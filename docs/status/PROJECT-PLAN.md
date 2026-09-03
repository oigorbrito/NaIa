# NaIa Project Plan Baseline

Date baseline: 2026-08-31
Last reconciled: 2026-09-03
Status: RESEARCH / PRE-MVP

## Current product thesis

NaIa is being explored as an operational personal/family AI assistant rather than a chat-only assistant.

Target control flow:

`intent -> objective -> plan -> policy/authorization -> tools -> execution -> evidence -> verification -> monitoring/recovery`

Product principles under research:

- resolve real tasks, not only answer questions;
- return user time rather than maximize attention;
- persistent goals rather than one-shot prompts;
- evidence for real-world actions;
- graduated autonomy based on risk;
- fail closed for sensitive ambiguity;
- personal/family context with explicit privacy boundaries;
- child/teen capabilities must have age-appropriate safety and legal requirements.

## Engineering method

- Prefer qualified existing components over reinventing commodity infrastructure.
- Challenge project preferences when stronger evidence supports another direction.
- Distinguish standards, independent empirical evidence, upstream tests, source inspection and vendor claims.
- Reproduce important external tests before final qualification.
- Record blockers as blockers; never convert unavailable evidence into PASS.
- Record rejected alternatives and why they were rejected.

## Current macro progression

### Block 1 — Structural consolidation

Goal: make the chassis laboratory internally coherent before runtime qualification.

State: COMPLETE (2026-09-03).

Receipt: `docs/evidence/BLOCK-1-STRUCTURAL-CONSOLIDATION-2026-09-03.md`.

Result:

- common T1–T16 vocabulary and critical-mutant set are versioned;
- neutral oracle/crash/evidence authorities are versioned;
- frozen formal promotion policy exists;
- reproduction profiles are reconciled with actual per-candidate structural coverage;
- Temporal, DBOS and Restate expose structural paths for T5/T7/T8/T11/T12/T16;
- Trigger.dev has structural T7/T8 coverage, including an exact self-hosted runner-container T7 boundary, but T5/T11/T12/T16 remain an explicit coverage gap;
- no runtime PASS or chassis winner was inferred from structural work.

### Block 2 — Runtime qualification

Goal: execute frozen candidate profiles under equivalent neutral evidence rules.

State: NEXT / NOT COMPLETE.

Primary constraints:

- B001 blocks local exact-runtime installation/execution in the recorded environment;
- B002 blocks repository CI before runner steps execute;
- B003 keeps Trigger.dev T7 runtime verification blocked even though its worker-container boundary is structurally implemented.

Exit requires reproducible critical-mutant verdicts sufficient for formal benchmark admission. A blocked or missing critical result cannot be silently promoted.

### Block 3 — Formal benchmark

Goal: compare promotion-qualified candidates and select `BENCHMARK_TO_BEAT`.

State: NOT STARTED.

### Block 4 — Chassis decision

Goal: challenger search, decision record and final chassis selection.

State: NOT STARTED.

### Block 5 — Minimal product shell

Goal: begin the product-facing NaIa shell only after the durable execution decision is defensible.

State: NOT STARTED.

## Later product work

After the chassis decision, reference architecture, capability evidence, empirical capability validation, MVP implementation and release qualification remain required. These concerns are intentionally not frozen by chassis research.

## Current decision status

`CHASSIS_WINNER = NOT_SELECTED`

`BENCHMARK_TO_BEAT = NOT_SELECTED`

`REFERENCE_ARCHITECTURE = NOT_FROZEN`

`MVP_SCOPE = NOT_FROZEN`

Immediate next objective: Block 2 runtime qualification against the frozen structural baseline.
