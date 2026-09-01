# T11 Cancel / Crash / Retry Contract V1

Status: CONTROL_SPECIFIED / TEMPORAL_DBOS_RESTATE_EXECUTORS_IMPLEMENTED_NOT_RUNTIME_VERIFIED

T11 tests `cancel_crash_retry_race` against the preregistered invariant `cancellation_blocks_future_unauthorized_progress`.

The contract does not assume that cancellation is instantaneous or non-cooperative. The fault window begins only after the candidate exposes candidate-native evidence that cancellation authority has been durably established for the objective. An API request merely sent over the network is not enough unless the candidate documents that its successful acknowledgement is itself the durable authority boundary.

## Deterministic schedule

A candidate-specific T11 driver must realize this semantic order:

1. `objective running` — a concrete worker/attempt is active and the durable objective identity is known.
2. `pre-cancel checkpoint` — the workload is held before a protected post-cancel operation.
3. `cancel submitted` — cancellation is requested through the candidate-native supported interface.
4. `cancel authority durable` — independent/native state proves the candidate has persisted the cancellation authority or terminal cancellation state.
5. `worker crash` — the worker/executor process that could otherwise continue is terminated at the declared worker boundary.
6. `recovery/retry attempted` — the candidate is restarted, resumed, retried, or otherwise given an opportunity to continue the same semantic objective.
7. `post-cancel progress challenged` — the recovering attempt reaches or attempts the protected operation boundary.
8. `post-recovery state inspected` — independent/native state and protected-resource evidence are collected.

The schedule must use explicit events/barriers. A sleep-only race is not admissible formal evidence.

## Protected progress

The protected operation is a neutral harness-owned append/commit authority outside the candidate durable store. It records every attempted and accepted operation using the stable objective identity. The candidate adapter must not receive a hidden cancellation flag from this resource. The resource is evidence, not an enforcement mechanism.

The protected operation may represent a durable internal transition or external effect, but it must be positioned after the cancellation authority boundary. T11 does not reuse T7/T8 response-loss or provider-idempotency semantics.

## Required evidence

```json
{
  "objectiveIdentity": "stable candidate-native objective identity",
  "oldWorkerIdentity": "worker/process/container before crash",
  "recoveryWorkerIdentity": "worker/process/container after crash",
  "cancelSubmission": {
    "attempted": true,
    "acknowledged": true
  },
  "cancelAuthority": {
    "durable": true,
    "nativeState": "candidate-specific state or authority marker"
  },
  "crash": {
    "injected": true,
    "targetIdentity": "oldWorkerIdentity"
  },
  "recovery": {
    "attempted": true
  },
  "postCancelProtectedOperation": {
    "attempted": true,
    "accepted": false,
    "acceptedCountAfterCancel": 0
  },
  "finalCancellationAuthoritative": true,
  "durableAuthorityAlive": true,
  "deterministicScheduleObserved": true,
  "rawNativeEvidence": {}
}
```

`attempted=true` for the post-cancel protected operation means the harness successfully exercised the recovery path far enough to challenge the authorization boundary. If the candidate prevents recovery from reaching the operation because cancellation is observed earlier, the driver may represent that as an explicit `blockedBeforeProtectedOperation=true`; this is admissible only when native evidence proves cancellation caused the block. It must not be inferred from timeout or process disappearance.

## PASS requirements

T11 PASS requires all of the following:

- stable objective identity across crash/recovery;
- concrete old and recovery worker identities where the profile exposes worker processes;
- cancellation request actually submitted;
- candidate-native durable cancellation authority observed before the crash;
- declared worker crash actually injected after that authority;
- recovery/retry actually attempted;
- either the protected post-cancel operation is explicitly rejected/non-authoritative, or native cancellation prevents reaching it with causal evidence;
- zero accepted protected operations after the durable cancellation authority;
- final candidate-native state remains cancelled/terminated according to the profile's cancellation semantics;
- durable authority remains available for post-recovery inspection;
- deterministic schedule is proven;
- normal formal cleanup gate passes.

If the cancellation authority boundary cannot be observed, the crash cannot be injected at the declared worker boundary, or recovery cannot be exercised, the record is `BLOCKED` or `INCONCLUSIVE` under existing rules. These conditions are not candidate FAIL by themselves.

## Candidate-specific admitted observations

Temporal may use durable Workflow history events such as `WorkflowExecutionCancelRequested` and `WorkflowExecutionCanceled`, provided the cancel-request event is observed before the worker crash and a distinct recovery Worker is shown handling the post-crash cancellation path.

DBOS may use candidate-native persisted workflow cancellation state and restart under the same stable executor/workflow identity, provided the old process is killed only after durable cancellation is proven and the restarted process is given an explicit recovery opportunity.

Restate may use its documented cancellation path, where cancellation is surfaced to handler code as a cancellation-specific `CancelledError` (a `TerminalError` subclass) at the next awaited Restate context action. For T11, a successful Admin API `PATCH /invocations/{id}/cancel` acknowledgement alone is insufficient because Restate documents cancellation as non-blocking. The driver must additionally observe the SDK-native cancellation in the old service process and the corresponding persisted cancellation output (`409`) before killing that process. Recovery is then challenged against the same workflow/invocation identity from a distinct registered deployment/process. If native terminal state rejects resume before the protected operation is reached, that is admissible `blockedBeforeProtectedOperation` evidence only when the terminal workflow output remains durable after the restart and the neutral oracle records zero accepted operations.

## Prohibited adaptations

The harness must not implement cancellation on behalf of the candidate. It must not add a separate fencing database, cancellation lock, or provider policy that suppresses post-cancel work. Candidate PASS must come from candidate-native cancellation/recovery semantics plus neutral observation.
