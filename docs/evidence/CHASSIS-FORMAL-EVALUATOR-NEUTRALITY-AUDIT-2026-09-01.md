# CHASSIS FORMAL EVALUATOR NEUTRALITY AUDIT — 2026-09-01

## Classification

- Scope: `CHASSIS_ONLY`
- Audit type: `STRUCTURAL_AUDIT + PURE_EVALUATOR_LOCAL_EXECUTION`
- Formal runtime verification: `NOT_RUNTIME_VERIFIED`
- Remote CI: `BLOCKED_REMOTE_CI_PRE_RUNNER`
- Workflow update attempt: `BLOCKED_TOOLING_OR_MODEL_POLICY`
- Formal ledger append: `CLOSED`
- Benchmark selection: `NOT_SELECTED`
- Chassis winner: `NOT_SELECTED`

This audit changes no candidate semantic outcome and does not promote lifecycle, cleanup-support, benchmark, or chassis status.

## Controlled-test boundary

- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Methodological basis

The V1 experiment remains `SPECIFIED_NOT_EXECUTED`. This audit therefore closes evaluator authority before formal outcomes exist rather than altering an analysis rule after results are observed.

The repository methodology requires equivalent acceptance rules traceable to raw observations across candidates. NIST SP 1500-18r2, Research Data Framework (RDaF) Version 2.0, defines reproducibility in terms of documented metadata, code, methods and instruments and separately identifies methods/protocols, software/tool parameters, versioning and provenance as information needed to reproduce computational research. This audit operationalizes that guidance by making semantic-evaluator code an explicit, versioned part of the formal harness identity.

Reference:

- NIST SP 1500-18r2, `Research Data Framework (RDaF) Version 2.0`, February 2024, DOI `10.6028/NIST.SP.1500-18r2`.

## Finding F1 — T7/T8 had multiple semantic authorities

Before this audit, benchmark-critical T7/T8 semantic success was partially duplicated across:

- `common-runner.mjs`;
- `common-runner-record-bridge.mjs`;
- `isolated-external-fault-runner.mjs`.

Those paths did not express exactly the same acceptance predicates. In particular, an isolated path could treat `RECONCILIATION_REQUIRED` as recovered terminal evidence while the already-frozen executable T7/T8 slice requires final `COMPLETED` for PASS.

This is an evaluator-authority defect, not candidate evidence and not a candidate FAIL.

## Finding F2 — existing frozen T7/T8 contract resolves the ambiguity

`research/chassis/EXECUTABLE-SLICE-T7-T8-T15.md` already specifies the V1 acceptance semantics.

For T7, PASS requires one intended semantic operation identity, one external apply, the intended process fault, no response-loss fault in isolated T7, recovery to completion, and final durable status `COMPLETED`.

For T8, PASS requires one intended semantic operation identity, exactly one response-loss fault, no duplicate external apply, completion without a rescue restart inside the repetition, and final durable status `COMPLETED`.

Therefore `RECONCILIATION_REQUIRED` remains useful observable evidence but is not T7/T8 PASS under this V1 contract.

## Finding F3 — one candidate-agnostic T7/T8 evaluator is now authoritative

New module:

`research/chassis/harness/t7-t8-evaluator.mjs`

`evaluateT7T8Semantics(mutantId, observation)` receives no candidate adapter or candidate name as an authority input. It evaluates raw semantic observations only.

Shared checks:

- exactly one external apply;
- one stable semantic operation identity;
- durable authority reachable;
- terminal recovery `objective_completed`;
- final status `COMPLETED`.

T7 additionally requires zero response losses.

T8 additionally requires that the measurement cutoff was not reached after the required response-loss fault.

Fault injection is deliberately outside the semantic evaluator. An absent intended fault remains `INCONCLUSIVE` under the experiment protocol rather than being converted into semantic FAIL.

## Finding F4 — formal bridge no longer trusts candidate/runner acceptance booleans

`common-runner-record-bridge.mjs` now recomputes formal T7/T8 semantic checks from raw runner/oracle/status observations using the neutral evaluator.

Precomputed `evidence.checks` cannot manufacture semantic PASS.

Fault injection is also derived from raw receipts rather than precomputed booleans:

- T7: observed kill receipt plus worker-process addressability;
- T8: exactly one oracle response-loss receipt.

Missing required semantic observations produce an invalid semantic evaluation and an empty acceptance-check set. The formal executor consequently preserves a prior infrastructure `BLOCKED` or, when the intended fault exists but semantic measurement is incomplete, produces `INCONCLUSIVE`; missing measurement is not manufactured into candidate FAIL.

## Finding F5 — common runner diagnostic now uses the same T7/T8 authority

`common-runner.mjs` imports and invokes `evaluateT7T8Semantics()` for critical T7/T8 diagnostic verdicts.

It no longer has an independent T7/T8 `measuredPass` definition. If required evaluator observations are incomplete it emits `NEUTRAL_EVALUATOR_OBSERVATION_INCOMPLETE` and remains non-authoritative for PASS/FAIL.

T15/COMPOSITE diagnostic logic is outside this critical T7/T8 evaluator consolidation and is not promoted by this audit.

## Finding F6 — evaluator authority was preregistered before formal execution

`experiment-protocol.v1.json` now contains amendment `A003`:

- status: `FROZEN_BEFORE_FORMAL_EXECUTION`;
- policy: `candidate-agnostic-evaluator-authority`;
- `outcomeDriven=false`;
- `changesSemanticVerdicts=false`;
- `changesRepetitionThreshold=false`.

A003 requires formal semantic acceptance for benchmark-critical mutants to be computed by candidate-agnostic evaluator code from raw observations. Candidate adapters/runners may translate native evidence but may not define or override success semantics.

`experiment-protocol-validator.mjs` locks the A003 policy and exact constraint. Removal or post-outcome mutation fails protocol validation.

## Finding F7 — all six critical mutants have candidate-agnostic evaluator authorities

Formal semantic authority set:

- T5 → `t5-evaluator.mjs`;
- T7/T8 → `t7-t8-evaluator.mjs`;
- T11 → `t11-evaluator.mjs`;
- T12 → `t12-evaluator.mjs`;
- T16 → `t16-evaluator.mjs`.

`critical-evaluator-neutrality.test.mjs` changes only the candidate label among Temporal TypeScript, DBOS TypeScript, Restate and Trigger.dev and requires identical evaluator output for every benchmark-critical mutant.

This tests candidate-name neutrality. It does not claim runtime equivalence of the candidate adapters themselves.

## Finding F8 — evaluator source is bound into formal harness provenance

`harness-provenance.mjs` now includes `t7-t8-evaluator.mjs` in `FORMAL_HARNESS_FILES` alongside T5/T11/T12/T16 evaluators.

Changing T7/T8 semantic acceptance code therefore changes the formal aggregate `harnessSha256`. Because one formal benchmark series may not mix harness identities, evaluator drift cannot be silently mixed into the same formal ledger.

## Executed evidence

A dependency-free local mirror of the exact pure evaluator modules was executed with Node tests outside GitHub Actions:

- tests: 5;
- PASS: 5;
- FAIL: 0.

Coverage included:

- T7 positive acceptance;
- T8 positive acceptance;
- `RECONCILIATION_REQUIRED` rejected as T7/T8 PASS;
- candidate/check bookkeeping fields unable to alter T7/T8 semantics;
- candidate-label neutrality across all six benchmark-critical evaluator authorities.

This evidence validates pure evaluator logic only. It is not lifecycle verification, candidate runtime verification, formal ledger evidence, or benchmark evidence.

A direct repository integration test was also added:

`research/chassis/harness/common-runner-neutral-evaluator.test.mjs`

It executes the real `common-runner.mjs`, local HTTP oracle, crash controller and neutral control adapter for isolated T7 and T8. At the time of this note that new integration test is `IMPLEMENTED_NOT_EXECUTED` by the remote runner.

## Tooling blocker while wiring the new integration test

An attempt to add `common-runner-neutral-evaluator.test.mjs` to `.github/workflows/research-chassis-worker-pid-provenance.yml` was blocked by the tool/policy layer before the repository write occurred.

Classification:

`BLOCKED_TOOLING_OR_MODEL_POLICY`

This is not a harness FAIL and is not a candidate FAIL. The workflow remains unchanged by that blocked write attempt. The production evaluator source itself is already part of `FORMAL_HARNESS_FILES` and therefore part of formal harness identity.

## Remote CI evidence

Branch head inspected before this audit note:

`0ceee6aac73952fbfe22f09109fabadf3cf8503c`

GitHub Actions push run:

- run: `33551131706`;
- `neutral-oracle (22)`: job `100000560161`, conclusion `failure`, `steps=null`;
- `neutral-oracle (24)`: job `100000560480`, conclusion `cancelled`, `steps=null`.

No checkout, Node setup, harness test or candidate operation started. Classification remains:

`BLOCKED_REMOTE_CI_PRE_RUNNER`

No retry is justified while the same pre-runner condition persists.

## Current formal state

- evaluator authority: `STRUCTURALLY_FROZEN`;
- pure evaluator local execution: `PASS_5_OF_5`;
- direct common-runner integration test: `IMPLEMENTED_NOT_REMOTE_EXECUTED`;
- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- formal ledger append: `CLOSED`;
- `BENCHMARK_TO_BEAT=NOT_SELECTED`;
- `CHASSIS_WINNER=NOT_SELECTED`.

## Next admissible evidence

When a runner actually starts steps:

1. execute protocol-validator, evaluator-neutrality, T7/T8 evaluator, common-runner integration and bridge tests;
2. execute the existing lifecycle qualification receipts for Temporal and DBOS;
3. retain raw record, validator output, hashes, Git revision, harness identity and execution reference;
4. do not promote cleanup/lifecycle status unless those receipts validate;
5. only after lifecycle support is runtime-verified perform the targeted Temporal T7/T8/T11/T16 reconciliation;
6. only then consider opening the preregistered 100-repetition round-robin formal ledger.

No benchmark or chassis winner is declared by this audit.
