# Benchmark Ledger Gate

Baseline: 2026-08-31

Decision state:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `BENCHMARK_EXECUTION_READY = false`

This gate prevents qualification probes or partially implemented mutant executors from being promoted into the preregistered benchmark ledger.

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

## 4. Complete evidence vs promotion

A complete/comparable dataset is not sufficient by itself to select a benchmark.

The qualification protocol states that critical failures must be resolved, excluded by a verifiable configuration, or explicitly accepted before final selection.

Accordingly:

- `BLOCKED` or `INCONCLUSIVE` in a benchmark-critical mutant prevents comparability;
- `FAIL` requires an explicit policy with `enforced=true`, a non-empty constraint and a non-empty justification before promotion;
- `PARTIAL` is accepted only for mutants predeclared as partial-eligible and only with an enforced policy;
- a documentation-only mitigation is not sufficient.

The promotion authority is `benchmark-promotion-gate.mjs`.

## 5. Provenance

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

## 6. Current interpretation

The harness may continue developing and executing neutral/control/qualification experiments while the benchmark start gate is closed.

No qualification result may be counted toward the 2400-record benchmark until:

1. all six critical mutant executors exist for every candidate mode under test;
2. the readiness gate opens;
3. execution begins from the exact first preregistered ledger slot;
4. subsequent records are appended only through the ledger guard.

No condition in this document selects a winner or a benchmark by itself.
