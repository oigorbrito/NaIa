# Benchmark Ledger Gate

Baseline: 2026-08-31

Decision state:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `BENCHMARK_EXECUTION_READY = false`

This gate prevents qualification probes or partially implemented mutant executors from being promoted into the preregistered benchmark ledger.

Methodological interpretation of this gate is additionally constrained by:

- `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`;
- `PRODUCT-READINESS-EVIDENCE-BOUNDARY-V1.md`;
- `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md`.

Those controls do not change ledger order, mutant semantics, repetition counts, acceptance rules, or promotion policy. They constrain which evidence domain may support a benchmark-candidate claim.

## 1. Benchmark start gate

Run:

```bash
npm run readiness:chassis
```

The 2400-record benchmark execution MUST NOT begin unless the result is:

```text
BENCHMARK_EXECUTION_READY
```

Current formal executor support:

- T7: `local-process` only;
- T8: `local-process` and `managed-controller`;
- T5: not implemented;
- T11: not implemented;
- T12: not implemented;
- T16: not implemented.

Trigger.dev T7 remains unsupported because `managed-controller` restart is not an actual worker/task-process SIGKILL.

Therefore the current expected readiness status is `BENCHMARK_EXECUTION_NOT_READY`.

## 2. Preregistered ledger order

The ledger is an ordered prefix of the execution plan generated from `experiment-protocol.v1.json` and `fault-suite.v1.json`.

Run:

```bash
npm run ledger:chassis
```

With an empty ledger, the next exact experiment is:

```text
experimentId = temporal-typescript-t5-001
candidate = Temporal TypeScript
mutantId = T5
repetition = 1
randomSeed = 1050001
```

A record cannot be appended unless all five identity fields match the next preregistered slot:

- experimentId;
- candidate;
- mutantId;
- repetition;
- randomSeed.

Out-of-order records, duplicate experiment IDs, candidate substitution, seed drift and sequence gaps invalidate the ledger.

## 3. Single-run qualification is not ledger append

`npm run single:chassis` currently supports isolated T7/T8 qualification runs.

A schema-valid single-run record is **not** automatically a benchmark record. The CLI reports:

```text
appended = false
eligibility = NOT_EVALUATED_WITHOUT_LEDGER_PREFIX
```

This distinction is intentional. For example, T7 repetition 1 cannot be appended to an empty ledger because T5 records precede it in the preregistered round-robin order.

T15 remains qualification-only and is outside the 2400-record critical ledger.

## 4. Claim-domain eligibility

A ledger-valid record and a benchmark-selection claim are separate statements.

For evidence to support a candidate runtime verdict or benchmark-selection decision, the corresponding claim-evidence record MUST declare:

```text
claimDomain = CHASSIS_CANDIDATE_RUNTIME
evidenceProducingDomain = CHASSIS_CANDIDATE_RUNTIME
```

and retain the exact candidate, harness, adapter, procedure/workload, environment and raw-artifact identities required by the reproducibility package.

Evidence from other domains may be cited only for the bounded statement it actually establishes. In particular:

```text
PRODUCT_READINESS       -> not candidate runtime evidence
HARNESS_CONTROL         -> not candidate runtime evidence
HARNESS_READINESS       -> not candidate runtime evidence
ENVIRONMENT_PREREQUISITE -> not candidate runtime evidence
CANDIDATE_STATIC        -> not candidate runtime evidence
```

Such evidence may explain readiness, instrumentation, prerequisites, or static capability, but it MUST NOT satisfy a missing `CHASSIS_CANDIDATE_RUNTIME` record or increase its evidence-strength label.

A domain-incompatible artifact does not invalidate itself; it is simply ineligible for the candidate-runtime claim being evaluated.

This rule is an evidence-scope/provenance constraint. It does not add a benchmark record, rerun requirement, mutant, threshold, acceptance condition, or repetition.

## 5. Complete evidence vs promotion

A complete/comparable dataset is not sufficient by itself to select a benchmark.

The qualification protocol states that critical failures must be resolved, excluded by a verifiable configuration, or explicitly accepted before final selection.

Accordingly:

- `BLOCKED` or `INCONCLUSIVE` in a benchmark-critical mutant prevents comparability;
- `FAIL` requires an explicit policy with `enforced=true`, a non-empty constraint and a non-empty justification before promotion;
- `PARTIAL` is accepted only for mutants predeclared as partial-eligible and only with an enforced policy;
- a documentation-only mitigation is not sufficient.

Before applying those promotion rules to a candidate claim, verify the claim-domain eligibility in Section 4. Domain eligibility is necessary for interpretation but does not replace any existing promotion condition.

The promotion authority is `benchmark-promotion-gate.mjs`.

## 6. Provenance

The formal harness aggregate fingerprint includes the execution mechanism and the decision/governance mechanisms, including:

- common runner and fault controls;
- experiment executor and validators;
- ledger validator;
- benchmark readiness gate;
- benchmark promotion gate;
- formal executor support SSOT;
- the provenance hasher itself;
- experiment protocol, fault suite, critical-mutant plan and adapter capability matrix.

Changing one of these inputs changes the formal harness provenance fingerprint.

The documentary claim-domain controls above identify the interpretation boundary for evidence. Unless and until those documentary files are themselves included in the executable fingerprint definition, editing them MUST NOT be represented as having changed the historical executable harness fingerprint.

## 7. Current interpretation

The harness may continue developing and executing neutral/control/qualification experiments while the benchmark start gate is closed.

No qualification result may be counted toward the 2400-record benchmark until:

1. all six critical mutant executors exist for every candidate mode under test;
2. the readiness gate opens;
3. execution begins from the exact first preregistered ledger slot;
4. subsequent records are appended only through the ledger guard.

For any later candidate verdict or benchmark-selection claim, the cited claim-evidence record must also satisfy the domain-eligibility rule in Section 4.

No condition in this document selects a winner or a benchmark by itself.
