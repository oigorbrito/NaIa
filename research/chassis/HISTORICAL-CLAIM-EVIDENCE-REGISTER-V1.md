# Historical Claim-Evidence Register V1

Status: DOCUMENTARY_RECONCILIATION

Purpose: apply the current claim-to-evidence discipline to already-versioned chassis artifacts without upgrading, downgrading, or reinterpreting their historical result states.

This register is a navigation and scope-control artifact. The underlying evidence files remain authoritative for the observations they contain.

## Registration rules

1. Historical language is preserved where possible.
2. No reconstructed control execution is promoted to independent reproduction.
3. No static-source audit is promoted to runtime evidence.
4. Environment/bootstrap blockers are not candidate failures.
5. Harness-readiness evidence is not candidate evidence.
6. A missing raw artifact or exact-checkout reproduction limits the evidence class; the register does not fill the gap by inference.
7. `CHASSIS_WINNER` and `BENCHMARK_TO_BEAT` remain `NOT_SELECTED` unless the benchmark gate is satisfied by executed comparable candidate evidence.
8. Every historical claim is assigned a `claimDomain` and an `evidenceProducingDomain`; those labels describe the scope of the preserved artifact and do not upgrade its evidence strength.
9. Cross-domain evidence may provide context, provenance, or a boundary condition, but it cannot supply a missing candidate-runtime result unless the original artifact actually measured candidate runtime behavior under the declared experiment contract.

Domain labels used in this register:

- `ENVIRONMENT_PREREQUISITE`: observations about execution prerequisites or infrastructure availability before candidate behavior is measured;
- `HARNESS_READINESS`: observations about whether the experiment machinery/executors are ready to run the declared benchmark;
- `CANDIDATE_STATIC`: source/configuration/contract observations about a candidate without runtime behavioral execution;
- `HARNESS_CONTROL`: executions intended to validate the discrimination or semantics of the harness/control itself;
- `CHASSIS_CANDIDATE_RUNTIME`: runtime evidence from an actual candidate execution under the declared experiment contract.

The first four domains do not imply `CHASSIS_CANDIDATE_RUNTIME` evidence.

## HCE-001 — Candidate runtime bootstrap was blocked in the observed environment

Claim ID: `HCE-001`

Claim domain: `ENVIRONMENT_PREREQUISITE`

Evidence-producing domain: `ENVIRONMENT_PREREQUISITE`

Claim:

> The observed 2026-08-31 execution environment could not install/bootstrap the frozen candidate runtimes, so candidate fault experiments were blocked before candidate behavior could be measured.

Procedure/evidence:

- `evidence/2026-08-31/b001-runtime-preflight.json`
- Node `v22.16.0`, npm `10.9.2`
- DNS resolution for `registry.npmjs.org` failed
- required candidate packages and, where applicable, environment configuration were absent

Observed result:

- blocker `B001`
- verdict `BLOCKED`
- candidate verdict authority explicitly `false`

Evidence class:

- `REPEATABILITY/REPRODUCTION CLAIM NOT ESTABLISHED`
- environment-prerequisite observation only

Allowed conclusion:

- candidate runtime installation/bootstrap was blocked in that environment

Disallowed conclusion:

- any candidate PASS/FAIL for T7, T8, T15, or other benchmark mutant
- any promotion to `CHASSIS_CANDIDATE_RUNTIME`

Decision impact:

- candidate execution remained pending
- winner selection remained unsupported

## HCE-002 — The full benchmark ledger was not execution-ready

Claim ID: `HCE-002`

Claim domain: `HARNESS_READINESS`

Evidence-producing domain: `HARNESS_READINESS`

Claim:

> The reconstructed benchmark-readiness check found that the full critical-mutant benchmark should not begin because required executors/mode compatibility were incomplete.

Procedure/evidence:

- `evidence/2026-08-31/benchmark-execution-readiness.json`
- exact Git blob identities for the reconstructed readiness modules were checked
- critical mutants considered: T5, T7, T8, T11, T12, T16

Observed result:

- `BENCHMARK_EXECUTION_NOT_READY`
- unsupported mutants: T5, T11, T12, T16
- Trigger.dev managed-controller mode incompatible with the then-declared T7 local-process support
- `candidateVerdictAuthority=false`

Evidence class:

- harness-readiness evidence
- reconstructed exact-module execution, not an independent repository reproduction

Allowed conclusion:

- the 2400-record benchmark ledger was not ready to start under the declared executor/mode contract

Disallowed conclusion:

- any chassis ranking or candidate PASS/FAIL
- any promotion to `CHASSIS_CANDIDATE_RUNTIME`

Decision impact:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`

## HCE-003 — Restate exposes static mechanisms relevant to T5, but formal T5 runtime execution was not available

Claim ID: `HCE-003`

Claim domain: `CANDIDATE_STATIC`

Evidence-producing domain: `CANDIDATE_STATIC`

Claim:

> Frozen Restate sources expose fencing/pause-resume/attempt-termination mechanisms relevant to T5 analysis, but the admitted benchmark surface did not provide a formal executor capable of submitting the required controlled stale completion after new authority was established.

Procedure/evidence:

- `evidence/2026-08-31/restate-t5-static-surface-audit.json`
- Restate server `1.7.8`
- TypeScript SDK `1.16.9`
- source-level inspection of fencing, admin pause/resume and SDK attempt termination

Observed result:

- `STATIC_MECHANISM_CONFIRMED_EXECUTOR_NOT_IMPLEMENTED`
- runtime verdict `NOT_EXECUTED`
- candidate verdict `NOT_ASSIGNED`

Evidence class:

- `STATIC_VERIFIED` for the source mechanisms described in the audit
- no runtime candidate evidence

Allowed conclusion:

- the identified mechanisms exist in the frozen source surface
- the then-current formal T5 executor was incomplete for Restate

Disallowed conclusion:

- Restate T5 PASS or FAIL
- inference that source-level fencing automatically satisfies the benchmark runtime invariant
- any promotion from `CANDIDATE_STATIC` to `CHASSIS_CANDIDATE_RUNTIME`

Decision impact:

- benchmark eligibility unchanged

## HCE-004 — T11 neutral controls discriminated the declared safe and unsafe semantics in reconstructed execution

Claim ID: `HCE-004`

Claim domain: `HARNESS_CONTROL`

Evidence-producing domain: `HARNESS_CONTROL`

Claim:

> The reconstructed neutral T11 control/evaluator distinguished the declared safe-cancellation case from intentionally unsafe/non-causal controls across the recorded deterministic repetitions.

Procedure/evidence:

- `evidence/2026-08-31/t11-cancel-retry-control-audit.json`
- contract: `T11-CANCEL-CRASH-RETRY-CONTRACT-V1.md`
- reconstructed minimal Node control
- 100 deterministic safe/unsafe pairs

Observed result:

- safe cancellation preserved: `PASS`
- unsafe cancellation forgotten: `EXPECTED_FAIL`
- 100/100 safe controls passed
- 100/100 unsafe controls failed
- exact repository checkout was not available

Evidence class:

- reconstructed harness-control execution
- not candidate evidence
- not independent reproduction

Allowed conclusion:

- the reconstructed neutral control was discriminating for the recorded T11 semantics in that execution

Disallowed conclusion:

- any candidate T11 PASS/FAIL
- `REPRODUCED_INDEPENDENT`
- formal benchmark eligibility based solely on the reconstructed control
- any promotion from `HARNESS_CONTROL` to `CHASSIS_CANDIDATE_RUNTIME`

Decision impact:

- validates control intent only; candidate execution still required

## HCE-005 — T5 neutral controls discriminated the corrected ownership-race semantics in reconstructed execution

Claim ID: `HCE-005`

Claim domain: `HARNESS_CONTROL`

Evidence-producing domains: `HARNESS_CONTROL` plus bounded `CANDIDATE_STATIC` observations

Claim:

> The reconstructed T5 neutral control/evaluator distinguished a fenced live ownership race from the declared negative and wrong-boundary schedules across the recorded deterministic repetitions.

Procedure/evidence:

- `evidence/2026-08-31/t5-ownership-race-harness-audit.json`
- T5 `concurrent_worker_ownership_race`
- 100 deterministic control repetitions
- reconstructed semantic execution, not a fresh repository checkout

Observed result:

- fenced live ownership race: `PASS`
- unfenced transient stale authority: expected negative-control failure
- stale-only-after-new-completion: rejected as wrong fault schedule
- single worker with two authority tokens: rejected as wrong worker boundary
- Temporal static support recorded; formal Temporal executor marked implemented but runtime-blocked by B001
- DBOS static finding recorded; formal executor not implemented

Evidence class:

- reconstructed harness-control execution plus static candidate-source observations
- not formal candidate evidence
- not independent reproduction

Allowed conclusion:

- the reconstructed T5 control discriminated the recorded ownership-race semantics
- identified candidate-specific mechanisms/executor gaps may be used to prepare later experiments

Disallowed conclusion:

- any Temporal/DBOS/Restate/Trigger.dev T5 PASS or FAIL
- chassis ranking
- any promotion of the control/static observations to `CHASSIS_CANDIDATE_RUNTIME`

Decision impact:

- formal ledger remained unstarted
- next expected experiment remained runtime candidate execution

## Evidence-class summary

| Claim | Claim domain | Evidence-producing domain | Strongest supported statement | Not supported |
| --- | --- | --- | --- | --- |
| HCE-001 | `ENVIRONMENT_PREREQUISITE` | `ENVIRONMENT_PREREQUISITE` | runtime bootstrap blocked in observed environment | candidate verdict |
| HCE-002 | `HARNESS_READINESS` | `HARNESS_READINESS` | full benchmark not ready under declared executor/mode contract | candidate ranking |
| HCE-003 | `CANDIDATE_STATIC` | `CANDIDATE_STATIC` | Restate mechanisms statically confirmed; executor gap documented | Restate runtime verdict |
| HCE-004 | `HARNESS_CONTROL` | `HARNESS_CONTROL` | T11 control discriminated recorded safe/unsafe semantics | candidate T11 verdict / independent reproduction |
| HCE-005 | `HARNESS_CONTROL` | `HARNESS_CONTROL` + `CANDIDATE_STATIC` | T5 control discriminated recorded schedules | candidate T5 verdict / chassis winner |

No HCE entry above is classified as `CHASSIS_CANDIDATE_RUNTIME`.

## Open evidence gaps

The historical artifacts do not establish the following:

- exact-checkout repeatable candidate execution for the critical mutants;
- independent reproduction of candidate runtime results;
- complete comparable critical-mutant coverage across all candidates;
- decision-eligible benchmark evidence;
- a selected chassis winner.

Closing any of these gaps requires new execution artifacts under the current runbook/reproducibility package rules. Documentation alone cannot close them.
