# Qualified Chassis Gate — Reproducible Runtime Runbook

Baseline date: 2026-08-31

Decision state:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`

This runbook operationalizes `reproduction-profiles.v1.json`, `fault-suite.v1.json`, the common external oracle, crash controller, and common runner. Documentation and source review define the hypothesis and the executable setup; only runtime evidence emitted by the common runner can produce candidate PASS/FAIL evidence.

Methodological controls are defined by:

- `EMPIRICAL-HARNESS-METHODOLOGY-V1.md`;
- `METHODOLOGY-SOURCE-MAP-V1.md`;
- `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`;
- `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md`;
- `HISTORICAL-CLAIM-EVIDENCE-REGISTER-V1.md` for scope-preserving registration of pre-existing evidence.

A recommendation presented as required empirical/reproducibility practice must satisfy the suggestion-admissibility rule in those documents. General engineering preference is not a harness requirement unless separately adopted as product policy.

Historical evidence must not be silently upgraded to the current evidence-strength ladder. `HISTORICAL-CLAIM-EVIDENCE-REGISTER-V1.md` records the strongest conclusion supported by each preserved artifact and the conclusions that remain disallowed.

## 1. Non-negotiable experiment contract

Use the same chain for every candidate:

`external oracle -> candidate adapter -> injected fault -> process/controller loss -> resume -> status -> independent evidence`

The candidate's internal workflow state is not authority for the external effect. The common oracle is the independent authority for `requestCount`, `applyCount`, `responseLossCount`, payload, timestamps, and all operation identities associated with an `objectiveId`.

For the current T7/T8/T15 slice, a candidate run cannot PASS unless the required fault was actually injected and all measured invariants hold. Missing runtime/package/service/configuration before fault injection is `BLOCKED`. A run that does not reach the required killpoint is `INCONCLUSIVE`. In managed-controller mode, controller restart is not evidence of worker SIGKILL.

## 2. Baseline verification before candidate runs

From repository root:

```bash
node --version
npm test
```

Record the Node major. The frozen profiles permit Node 22 or 24.

Expected harness controls:

- stable control -> `PASS`
- operation identity drift mutant -> `FAIL`
- missing runtime prerequisite -> `BLOCKED`
- killpoint not reached -> `INCONCLUSIVE`

Do not proceed to 100-run candidate repetitions if these controls are not discriminating correctly.

A control result is harness-validation evidence; it is not candidate evidence.

## 3. Evidence file convention

Store candidate evidence under a run-specific directory, for example:

```text
research/chassis/evidence/<timestamp>/<profile-id>/evidence.json
```

For every run also record, outside or alongside `evidence.json`:

- repository HEAD SHA;
- Node version;
- adapter SHA-256 (the runner records this automatically);
- package lockfile and package-manager version;
- installed package versions and integrity data;
- server/container/CLI version and immutable image digest where applicable;
- database version/image digest where applicable;
- environment variables by name only; never persist secrets;
- exact runner command;
- bootstrap and cleanup commands actually used;
- blocker or inconclusive reason, if any.

A command in this runbook marked `TO_VERIFY` is a prepared reproduction command, not evidence that it has already executed successfully.

### 3.1 Minimum reproducibility package

Before a result is labeled `REPEATABLE_LOCAL`, complete `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md` for the experiment series. The run directory or linked artifact package must let a reviewer determine, without private corrective communication:

- what candidate/version was evaluated;
- what harness/adapter version was used;
- what environment and dependencies were used;
- what input/workload and fault primitive were applied;
- how to invoke setup, run and cleanup;
- where the raw observations are stored;
- what acceptance rule converted observations into the verdict;
- whether any prerequisite remained unavailable or substituted.

Before a result is labeled `REPRODUCED_INDEPENDENT`, the independent environment/person must record its own environment manifest, invocation, raw evidence and verdict. Reusing the original investigator's summary alone is insufficient.

### 3.2 Claim-to-evidence linkage

Every benchmark-relevant run or batch summary must instantiate `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md` with a unique `claimId` and link that claim to:

```text
claim -> procedure -> environment -> raw artifacts -> acceptance check -> observed result -> decision
```

If the raw artifacts cannot be located from the completed register, the summary is documentary only and is not decision-eligible.

One register may cite many repetitions only when they share the same experiment contract. Materially changed workloads, fault boundaries, oracle semantics, acceptance meanings or version-specific claims require a new experiment-series identity.

Existing historical artifacts are indexed in `HISTORICAL-CLAIM-EVIDENCE-REGISTER-V1.md`; that register is documentary reconciliation and does not manufacture missing execution metadata.

## 4. Common runner invocation

Local-process candidates use:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter <adapter-path> \
  --candidate <profile-id> \
  --mode local-process \
  --timeout-ms 15000 \
  --output <evidence-path>
```

Managed-controller candidates require an independently reachable oracle URL:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter <adapter-path> \
  --candidate <profile-id> \
  --mode managed-controller \
  --oracle-url <reachable-oracle-url> \
  --timeout-ms 15000 \
  --output <evidence-path>
```

For managed workers running outside the controller host/container, `127.0.0.1` on the controller is not a valid oracle address unless the network topology explicitly makes it reachable from the worker.

## 5. Temporal TypeScript — `temporal-ts-restricted-v1`

Frozen identities:

- `@temporalio/worker = 1.23.0`
- `@temporalio/client = 1.23.0`
- `@temporalio/workflow = 1.23.0`
- `@temporalio/activity = 1.23.0`
- Temporal CLI `v1.7.3`
- effective server `v1.31.2` from the CLI release's pinned server dependency

Install the exact SDK versions in the adapter workspace and commit/retain the generated lockfile:

```bash
npm install --save-exact \
  @temporalio/worker@1.23.0 \
  @temporalio/client@1.23.0 \
  @temporalio/workflow@1.23.0 \
  @temporalio/activity@1.23.0
```

Bootstrap target:

```bash
# TO_VERIFY in the executable environment with Temporal CLI v1.7.3
temporal server start-dev
```

Adapter defaults, unless explicitly overridden:

```text
TEMPORAL_ADDRESS=127.0.0.1:7233
TEMPORAL_NAMESPACE=default
NAIA_TEMPORAL_TASK_QUEUE=naia-chassis-gate-v1
```

Run:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter research/chassis/adapters/temporal-ts/adapter.mjs \
  --candidate temporal-ts-restricted-v1 \
  --mode local-process \
  --timeout-ms 15000 \
  --output <evidence-path>
```

Cleanup must stop the development server and remove only disposable experiment state. Record how the server was stopped and the server/CLI identity used.

## 6. DBOS TypeScript — `dbos-ts-v4.27`

Frozen identities:

- reviewed source tag `v4.27`
- installed npm artifact target `@dbos-inc/dbos-sdk = 4.27.6`
- PostgreSQL required; exact version/image must be recorded at execution time
- executor ID `naia-chassis-local-executor`
- application version `naia-chassis-gate-v1`

Install:

```bash
npm install --save-exact @dbos-inc/dbos-sdk@4.27.6
```

Before accepting evidence, verify that APIs used by the adapter match the installed `4.27.6` artifact and record lockfile integrity. Source-tag review alone is insufficient.

PostgreSQL bootstrap is environment-specific and remains `TO_VERIFY`; use a disposable database instance, pin its version/image, and record the connection configuration without committing credentials.

Run:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter research/chassis/adapters/dbos-ts/adapter.mjs \
  --candidate dbos-ts-v4.27 \
  --mode local-process \
  --timeout-ms 15000 \
  --output <evidence-path>
```

The final evidence must state whether DBOS Conductor or an equivalent executor-recovery mechanism was present. Do not attribute multi-process recovery to DBOS unless the tested topology actually includes it.

Cleanup must terminate adapter processes and remove the disposable PostgreSQL resources created for the run.

## 7. Restate — `restate-ts-v1`

Frozen identities:

- Restate server `v1.7.8`
- `@restatedev/restate-sdk = 1.16.9`
- `@restatedev/restate-sdk-clients = 1.16.9`

Install:

```bash
npm install --save-exact \
  @restatedev/restate-sdk@1.16.9 \
  @restatedev/restate-sdk-clients@1.16.9
```

Server bootstrap is `TO_VERIFY` in the executable environment. Use only server `v1.7.8`, record the binary/container identity and immutable digest when a container is used, and do not silently substitute a newer release.

Run:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter research/chassis/adapters/restate-ts/adapter.mjs \
  --candidate restate-ts-v1 \
  --mode local-process \
  --timeout-ms 15000 \
  --output <evidence-path>
```

The server BSL 1.1 license remains a separate acceptance gate. Technical PASS does not imply licensing acceptance.

Cleanup must stop the exact Restate server instance used and remove only disposable experiment state.

## 8. Trigger.dev — `triggerdev-v4.5.15`

Frozen identities:

- `@trigger.dev/sdk = 4.5.15`
- `@trigger.dev/build = 4.5.15`
- `trigger.dev = 4.5.15`
- self-host image `ghcr.io/triggerdotdev/trigger.dev:v4.5.15`

Install in `research/chassis/adapters/triggerdev`:

```bash
npm install
```

The adapter package file pins the three Trigger.dev packages exactly at `4.5.15`; retain the generated lockfile and record integrity.

Required managed-controller configuration:

```text
NAIA_TRIGGER_PROJECT_REF
TRIGGER_SECRET_KEY
```

Optional/configuration-dependent:

```text
TRIGGER_API_URL
TRIGGER_PREVIEW_BRANCH
```

The external oracle URL must be reachable from the actual Trigger.dev worker.

Run:

```bash
node research/chassis/harness/common-runner.mjs \
  --adapter research/chassis/adapters/triggerdev/adapter.mjs \
  --candidate triggerdev-v4.5.15 \
  --mode managed-controller \
  --oracle-url <worker-reachable-oracle-url> \
  --timeout-ms 15000 \
  --output <evidence-path>
```

Interpretation constraint:

- controller restart may contribute evidence for T8 and T15;
- it is not T7 worker-SIGKILL evidence;
- `T7_worker_sigkill` remains `NOT_EXECUTED`/candidate result `INCONCLUSIVE` until a self-hosted worker/workload crash hook kills the correct process boundary.

Do not count Trigger task idempotency as proof of arbitrary external-effect idempotency; the oracle decides duplicate external effects.

Cleanup must cancel/finish disposable runs and remove self-host resources created for the experiment without deleting unrelated project data.

## 9. Verdict rules

`PASS` requires all of the following for the mutant actually under test:

- required fault was injected;
- restart/resume occurred at the intended boundary;
- objective completed;
- final status is coherent;
- expected semantic operation was applied;
- all external effects related to the objective use exactly one operation identity;
- `totalApplyCount === 1`;
- for T8, exactly one response loss was observed;
- the conclusion does not rely solely on chassis-internal completion state.

`FAIL` is reserved for an executed experiment that violates a candidate invariant.

`BLOCKED` is reserved for missing package/runtime/configuration/service or equivalent prerequisite failure before the fault experiment.

`INCONCLUSIVE` is reserved for an experiment where the required fault boundary was not actually exercised, including killpoint not reached or a controller-loss mode that does not represent the required worker crash.

Infrastructure failure is not candidate failure unless that infrastructure component is itself part of the predeclared candidate claim under test.

## 10. Repetition protocol

First prove one run is instrumented correctly. Only then scale the corresponding critical mutant to the repetition requirement in `fault-suite.v1.json` (currently 100 for relevant critical mutants).

For each repetition, use a fresh `objectiveId`; the runner generates one by default. Preserve all evidence files. A batch result must not hide individual failures, blockers, or inconclusive runs.

Do not merge runs from materially different experiment contracts into one success rate. A change to workload semantics, fault boundary, acceptance rule, oracle semantics or version-specific candidate identity starts a new experiment series unless comparability is explicitly justified.

## 11. Documentation and artifact quality check

Before candidate-scale execution, verify that the package is:

- `DOCUMENTED`: inventory, environment requirements and invocation instructions exist;
- `CONSISTENT`: the supplied artifacts correspond to the claim being tested;
- `COMPLETE`: required components are present or their acquisition procedure is documented;
- `EXERCISABLE`: setup/run/cleanup commands can be invoked as documented;
- `VERIFIABLE`: harness controls expose evidence that expected PASS/FAIL/BLOCKED/INCONCLUSIVE states are distinguishable.

Use `REPRODUCIBILITY-PACKAGE-CHECKLIST-V1.md` as the auditable checklist for identity/provenance, environment, procedure, raw evidence, repetition completeness, result classification, comparability and evidence-strength labels.

This check qualifies the artifact package. It does not qualify any candidate as PASS and does not constitute independent reproduction.

## 12. Decision/reporting rule

Every recommendation to select, reject, rank or replace a chassis must cite completed claim-to-evidence records created from `CLAIM-EVIDENCE-REGISTER-TEMPLATE.md`.

Allowed decision language is bounded by evidence class:

- `DOCUMENTED` -> describe documented capability only;
- `STATIC_VERIFIED` -> describe validated contract/static property only;
- `REPEATABLE_LOCAL` -> describe locally observed runtime behavior under the declared conditions;
- `REPRODUCED_INDEPENDENT` -> state independent reproduction for the specific claim;
- `DECISION_ELIGIBLE` -> use the result in benchmark selection if all comparison gates are also satisfied.

If required evidence is absent, the supported recommendation is to execute/reproduce the missing experiment, not to infer the winner.

A narrative recommendation without exact claim IDs and evidence references is not decision-eligible even when it summarizes otherwise valid runs.

For historical evidence, use the HCE claim IDs in `HISTORICAL-CLAIM-EVIDENCE-REGISTER-V1.md`; those IDs preserve historical scope and are not evidence-strength upgrades.

## 13. Current environment blockers

`B001` remains the candidate-runtime installation/bootstrap blocker observed in the prior execution environment. It is not candidate failure.

Separately, on 2026-08-31 the GitHub Actions `Research Chassis Harness` jobs for Node 22 and 24 failed before exposing executable steps/logs through the available interface. This is an infrastructure/CI blocker and must not be converted into a harness or candidate FAIL. The harness controls were independently re-executed locally under Node 22 after reconstruction from the versioned files; candidate runtime execution is still required.

Until comparable runtime evidence exists for the required critical mutants:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
