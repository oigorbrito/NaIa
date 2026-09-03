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

State: BLOCKED / EXTERNAL EXECUTION ENVIRONMENT (2026-09-03).

Receipt: `docs/evidence/BLOCK-2-RUNTIME-QUALIFICATION-BLOCKED-2026-09-03.md`.

What was established:

- the Block 1 closing HEAD was revalidated before execution work;
- GitHub Actions run `33801754420` was re-run at that baseline;
- attempt 2 reproduced the pre-runner condition: Node 22 failure, Node 24 cancelled, both with no steps;
- Temporal, DBOS and Restate candidate-specific critical runtime qualification workflows are present and structurally ready to emit isolated runtime evidence when a runner is available;
- no candidate verdict was inferred from unavailable execution.

Open constraints:

- B001: exact local-runtime execution unavailable in the recorded local environment;
- B002: repository GitHub Actions execution blocked before runner steps;
- B003: Trigger.dev T7 self-hosted runtime proof absent;
- B004: Trigger.dev T5/T11/T12/T16 structural coverage absent.

Exit remains unsatisfied. `FORMAL_RUNTIME_QUALIFICATION = NOT_EXECUTED` and `FORMAL_LEDGER_APPEND = CLOSED`.

### Block 3 — Formal benchmark

Goal: compare promotion-qualified candidates and select `BENCHMARK_TO_BEAT`.

State: CLOSED BY BLOCK 2 GATE / NOT STARTED.

Do not start while Block 2 lacks promotion-qualified critical runtime receipts.

### Block 4 — Chassis decision

Goal: challenger search, decision record and final chassis selection.

State: NOT STARTED.

### Block 5 — Minimal product shell

Goal: begin the product-facing NaIa shell only after the durable execution decision is defensible.

State: NOT STARTED.

## Later product work

After the chassis decision, reference architecture, capability evidence, empirical capability validation, MVP implementation and release qualification remain required. These concerns are intentionally not frozen by chassis research.

## Current decision status

`BLOCK_1_STRUCTURAL_CONSOLIDATION = PASS`

`BLOCK_2_RUNTIME_QUALIFICATION = BLOCKED_EXTERNAL_EXECUTION_ENVIRONMENT`

`FORMAL_RUNTIME_QUALIFICATION = NOT_EXECUTED`

`FORMAL_LEDGER_APPEND = CLOSED`

`CHASSIS_WINNER = NOT_SELECTED`

`BENCHMARK_TO_BEAT = NOT_SELECTED`

`REFERENCE_ARCHITECTURE = NOT_FROZEN`

`MVP_SCOPE = NOT_FROZEN`

Immediate next objective: restore a legitimate execution boundary and resume Block 2 from the frozen structural baseline. Do not advance to Block 3 before runtime qualification gates are satisfied.
