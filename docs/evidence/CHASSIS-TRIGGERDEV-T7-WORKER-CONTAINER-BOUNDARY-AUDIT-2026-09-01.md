# CHASSIS TRIGGER.DEV T7 WORKER-CONTAINER BOUNDARY AUDIT — 2026-09-01

## Scope

- `CHASSIS_ONLY`
- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Work unit

`CHASSIS_TRIGGERDEV_T7_WORKER_CONTAINER_BOUNDARY_AUDIT_V1`

Source state entering this work unit:

- branch: `research/qualified-chassis-gate-v1`
- pre-work HEAD: `75d9782998e4e1f433c623ae97e4bbba91bab428`
- Trigger.dev frozen version: `4.5.15`
- Trigger.dev frozen upstream source commit: `52848d8266435bf62d4b3eb66162d24757d2b753`

No formal benchmark execution was performed by this work unit.
No protocol amendment was introduced.
No candidate was promoted.

## Prior blocker

`B003` previously meant:

`MANAGED_CONTROLLER_WORKER_SIGKILL_HOOK_NOT_IMPLEMENTED`

The existing common runner could start the Trigger.dev adapter/controller, but it could not address the actual task worker. Killing the adapter/controller is not a valid T7 worker fault under the preregistered critical-mutant plan.

The prior managed-controller common-runner path therefore correctly reported Trigger.dev T7 as not executed.

## Frozen upstream boundary evidence

The exact Trigger.dev source revision frozen by the candidate profile was inspected rather than inferring behavior from current `main`.

Relevant upstream files at commit `52848d8266435bf62d4b3eb66162d24757d2b753`:

- `hosting/docker/worker/docker-compose.yml`
- `apps/supervisor/src/workloadManager/docker.ts`
- `apps/supervisor/src/util.ts`

The frozen self-hosted Docker topology separates the supervisor/control process from per-run workload containers.

The Docker workload manager:

1. derives a runner identity from `runFriendlyId` and attempt number;
2. creates a distinct Docker container for that runner;
3. stamps `TRIGGER_RUN_ID=<runFriendlyId>`;
4. stamps `TRIGGER_RUNNER_ID=<runnerId>`;
5. starts the container separately from the supervisor.

The frozen `getRunnerId()` rule is:

- first attempt: `runner-<runFriendlyId without run_>`
- later attempt: `runner-<runFriendlyId without run_>-attempt-N`

The frozen Docker worker compose also sets `DOCKER_AUTOREMOVE_EXITED_CONTAINERS=0`, allowing post-fault container inspection instead of relying only on the return code of a kill command.

Upstream repository:

`https://github.com/triggerdotdev/trigger.dev`

Frozen source:

`https://github.com/triggerdotdev/trigger.dev/tree/52848d8266435bf62d4b3eb66162d24757d2b753`

## Finding

`B003` was not an inherent inability of Trigger.dev 4.5.15 to expose a worker boundary under the frozen self-hosted Docker profile.

It was an implementation gap in the NaIa harness.

However, container addressability alone is insufficient for valid T7 evidence. The fault must occur after the external effect is observed and before the first attempt can complete/checkpoint. The previous Trigger.dev task returned immediately after the oracle response, so an external Docker kill could otherwise occur too late and produce invalid evidence.

## Structural implementation

### Controlled first-attempt fault barrier

`research/chassis/adapters/triggerdev/trigger/naia-objective.mjs`

The task now accepts a harness-only fault barrier payload. When explicitly enabled, only attempt 1 pauses after the oracle apply is confirmed and before task completion.

Retry attempts do not enter the barrier.

This barrier changes timing only. It does not:

- change the semantic evaluator;
- change PASS/FAIL criteria;
- change operation identity;
- synthesize a fault;
- alter durable Trigger.dev control-plane state directly;
- modify private upstream state.

### Adapter payload

`research/chassis/adapters/triggerdev/adapter.mjs`

The adapter forwards the controlled barrier only when the harness explicitly sets:

- `NAIA_HOLD_AFTER_EXTERNAL_EFFECT=1`
- `NAIA_HOLD_AFTER_EXTERNAL_EFFECT_MS=<bounded duration>`

Normal adapter execution does not enable the barrier.

### Dedicated managed T7 hook

`research/chassis/harness/triggerdev-managed-t7-run-hook.mjs`

The dedicated hook does not use the generic local-process crash controller.

It:

1. starts the Trigger.dev adapter/controller and leaves it alive;
2. observes the persisted Trigger.dev run friendly ID;
3. independently observes `applyCount >= 1` from the external oracle;
4. derives the exact frozen upstream runner name;
5. calls `docker inspect` on that runner;
6. accepts the worker boundary only if all of these match:
   - exact runner container name;
   - exact `TRIGGER_RUN_ID`;
   - exact `TRIGGER_RUNNER_ID`;
   - concrete container ID;
   - concrete host PID;
   - container currently running;
7. sends `docker kill --signal KILL` to the validated worker container only;
8. reinspects the same container;
9. sets `fault.injected=true` only if the same container is confirmed stopped and its original container PID is no longer active;
10. leaves semantic acceptance to the existing candidate-agnostic T7/T8 evaluator.

The resulting fault evidence uses:

- `targetKind = worker-container`
- `targetIdentity = <validated container ID>`
- `signal = SIGKILL`

The adapter/controller and supervisor are not accepted as T7 targets.

### Fail-closed behavior

If the worker container cannot be addressed, the hook returns a blocker rather than candidate FAIL.

If Docker accepts the kill command but worker death cannot be independently confirmed, the hook reports `fault.injected=false`. The experiment therefore remains `INCONCLUSIVE` rather than manufacturing a PASS or FAIL.

When a run has already been started but the harness cannot continue to a valid fault, the hook attempts an explicit adapter-level cancellation to reduce cross-run contamination.

### Executor routing

`research/chassis/harness/common-runner-run-hook.mjs`

Trigger.dev T7 in `managed-controller` mode now routes to the dedicated worker-container hook before the generic common runner.

It therefore no longer uses the process-kill path that targets the controller.

### Formal executor matrix

`research/chassis/harness/formal-executor-support.mjs`

T7 now declares both:

- `local-process`
- `managed-controller`

This is structural executor support only.

It does not mean Trigger.dev is benchmark-ready.

### Formal harness provenance

`research/chassis/harness/harness-provenance.mjs`

The Trigger.dev managed T7 hook is part of `FORMAL_HARNESS_FILES`.

The existing transitive-authority gate therefore requires this production authority to remain inside formal harness identity.

### Structural tests

`research/chassis/harness/triggerdev-managed-t7-run-hook.test.mjs`

Tests define the expected structural invariants for:

- frozen runner naming;
- exact workload-container run identity;
- supervisor/controller rejection;
- wrong-run rejection;
- confirmed post-kill stopped state;
- rejection when the container remains running;
- rejection when post-kill evidence references another container;
- formal managed-controller T7 executor support.

The research chassis structural workflow now includes this test.

No remote PASS is claimed until the workflow actually receives a runner and executes its steps.

## Blocker reclassification

`B003` is retained but refined to:

`MANAGED_CONTROLLER_WORKER_SIGKILL_HOOK_IMPLEMENTED_NOT_RUNTIME_VERIFIED`

Trigger.dev remains:

`runtime_status = BLOCKED_B001_B003`

The blocker must not be removed until a real frozen self-hosted Docker execution demonstrates all required conditions, including:

1. exact runner-container identity;
2. external apply observed before fault;
3. actual worker-container SIGKILL;
4. post-kill worker death confirmation;
5. control plane remains reachable;
6. recovery/retry reaches the frozen T7 terminal contract;
7. external apply count remains exactly one;
8. operation identity remains stable;
9. cleanup proves the observed worker authority is no longer alive.

## Remaining Trigger.dev benchmark gaps

Even if B003 is later runtime-verified, Trigger.dev is not benchmark-execution-ready.

Current structural gaps remain for:

- T5
- T11
- T12
- T16

Formal cleanup lifecycle support for Trigger.dev also remains `NOT_IMPLEMENTED`.

Therefore this work does not open the formal ledger or the four-candidate benchmark.

## Evidence classification

Current classification for this work unit:

`TRIGGERDEV_T7_WORKER_CONTAINER_BOUNDARY = STRUCTURALLY_IMPLEMENTED_NOT_RUNTIME_VERIFIED`

`B003 = OPEN_PENDING_RUNTIME_VERIFICATION`

`FORMAL_LEDGER_APPEND = CLOSED`

`BENCHMARK_TO_BEAT = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`
