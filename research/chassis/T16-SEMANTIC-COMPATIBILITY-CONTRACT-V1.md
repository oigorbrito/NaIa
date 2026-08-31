# T16 Semantic Compatibility Contract V1

Status: CONTROL_VALIDATED / TEMPORAL_DBOS_EXECUTORS_IMPLEMENTED_NOT_RUNTIME_VERIFIED

T16 tests `identity_or_config_changes_before_recovery`: durable work created under semantic profile A is recovered under intentionally changed profile B while the semantic objective identity is preserved.

The property under test is not whether configuration can change. The property is whether a change that can alter recovery meaning is handled explicitly. A candidate may PASS by rejecting the incompatible recovery, by routing to compatible code/config, or by applying an explicit migration whose identity and transformation are recorded. Silently continuing with changed meaning is FAIL.

## Controlled mutation

Each T16 repetition changes exactly one declared semantic dimension. Examples include workflow/application version, deployment/build identity, handler/task identity, tool contract version, serialization/schema version, or a configuration value that changes externally observable behavior.

Incidental environment differences that do not change semantics are not T16 mutations.

The record must contain:

```json
{
  "semanticMutation": {
    "dimension": "applicationVersion",
    "before": "v1",
    "after": "v2"
  }
}
```

`before` and `after` must be concrete and different.

## Deterministic schedule

1. Start one objective under semantic profile A.
2. Reach a durable checkpoint proving the objective exists under A.
3. Stop/crash the execution boundary without deleting durable authority.
4. Change exactly one declared semantic dimension from A to B.
5. Attempt recovery of the same objective identity under B.
6. Observe the candidate-native compatibility disposition before accepting new externally visible progress.
7. Inspect final durable state and any external-effect evidence.

Sleep-only scheduling is insufficient. The checkpoint, mutation, recovery attempt, compatibility disposition, and final inspection must be explicit observations.

## Admissible safe dispositions

A recovery is safe when one of these is proven:

- `REJECTED_INCOMPATIBLE`: native recovery refuses B and preserves prior durable meaning;
- `ROUTED_TO_COMPATIBLE`: native version/deployment routing sends recovery to code/config compatible with A;
- `EXPLICIT_MIGRATION`: a declared migration transforms A to B, with migration identity and before/after evidence recorded.

The following is unsafe:

- `SILENT_REINTERPRETATION`: recovery continues under B with different semantic behavior and no explicit compatibility gate or migration.

Unknown/ambiguous disposition is not PASS.

## Required evidence

```json
{
  "objectiveIdentity": "...",
  "semanticMutation": {"dimension":"...","before":"...","after":"..."},
  "durableCheckpointBeforeMutation": true,
  "recoveryAttemptedUnderMutatedProfile": true,
  "compatibilityDisposition": {
    "kind": "REJECTED_INCOMPATIBLE|ROUTED_TO_COMPATIBLE|EXPLICIT_MIGRATION|SILENT_REINTERPRETATION|UNKNOWN",
    "explicit": true,
    "migrationIdentity": null
  },
  "silentSemanticChangeObserved": false,
  "priorMeaningPreservedOrExplicitlyMigrated": true,
  "durableAuthorityAlive": true,
  "deterministicScheduleObserved": true,
  "rawNativeEvidence": {}
}
```

For `EXPLICIT_MIGRATION`, `migrationIdentity` is required. For rejection/routing it may be null.

## Temporal TypeScript 1.23.0 structural slice

The Temporal T16 driver mutates exactly the workflow implementation content SHA while preserving workflow ID, workflow type, task queue, namespace and durable server/history. Profile A emits a durable timer command and then waits for a release signal. After the timer and a subsequent Workflow Task completion are present in history, worker A is SIGKILLed. Profile B deliberately omits that timer command.

Worker B uses the same workflow type and task queue with `maxCachedWorkflows=0`, forcing replay. The harness polls the public `WorkflowHandle.fetchHistory()` API and requires an actual `WorkflowTaskFailed` event whose native failure message contains `Nondeterminism`. Only that native history event classifies B as `REJECTED_INCOMPATIBLE`; timeout or absence of progress does not.

Worker C then starts with profile A, signals the original workflow and must receive a terminal result whose semantic profile is A. This proves that the incompatible B task was rejected while the original durable meaning remained recoverable.

The design follows the Temporal TypeScript 1.23.0 upstream nondeterminism test, which itself uses `fetchHistory()` to detect `WorkflowTaskFailed` containing `Nondeterminism` and documents that the default behavior fails the Workflow Task rather than silently completing the workflow under incompatible semantics.

Structural implementation is not candidate PASS. It remains runtime-unverified while B001 prevents execution of the exact Temporal SDK/server profile.

## DBOS v4.27 structural slice

The DBOS T16 driver mutates exactly `applicationVersion` while preserving the workflow identity and executor identity. Worker A creates a durable step checkpoint under version A and is SIGKILLed. Worker B starts under version B and the harness inspects the native workflow record after `DBOS.launch()` recovery processing. The experiment then starts worker C under version A and requires the original workflow to recover and complete under A before classifying the result as `ROUTED_TO_COMPATIBLE`.

This design is aligned with the DBOS v4.27 upstream application-version recovery test, which demonstrates that pending work is recovered under the matching application version and is not recovered after the application version/source changes. Structural implementation is not candidate PASS. It remains runtime-unverified while B001 prevents installation/startup of the pinned DBOS/PostgreSQL profile.

## PASS requirements

T16 PASS requires all of the following:

- same concrete objective identity before and after the mutation attempt;
- exactly one concrete semantic dimension changed and `before != after`;
- durable checkpoint exists before mutation;
- recovery under the mutated profile is actually attempted;
- compatibility disposition is explicit and one of the three safe dispositions;
- no silent semantic change is observed;
- prior meaning is preserved or an explicit migration is proven;
- durable authority remains alive and independently inspectable;
- deterministic schedule is proven;
- normal formal cleanup succeeds.

If compatibility disposition cannot be observed, the mutation is not semantic, recovery is not attempted, or the durable authority cannot be inspected, the result is BLOCKED or INCONCLUSIVE according to existing runtime rules, never PASS.

## Prohibited adaptations

The harness must not add a compatibility database, version router, migration layer, or semantic checksum solely for the benchmark when the candidate/deployment would not normally provide it. Candidate PASS must come from candidate-native versioning/compatibility mechanisms or an application migration policy declared as part of the qualified profile before the run.
