# Restate T16 structural slice — 2026-08-31

Status: IMPLEMENTED_NOT_RUNTIME_VERIFIED

Decision state:

- `CHASSIS_WINNER = NOT_SELECTED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `RESTATE_T16_CANDIDATE_PASS = NOT_CLAIMED`

## Frozen profile

- Restate server: `v1.7.8`
- TypeScript SDK: `1.16.9`
- TypeScript clients: `1.16.9`
- mode: `local-process`
- current runtime blocker: `B001 = LOCAL_RUNTIME_DEPENDENCY_INSTALL_UNAVAILABLE`

## Upstream mechanism used

Restate server `v1.7.8` exposes candidate-native Admin API operations that are directly relevant to T16:

1. `POST /deployments` registers a new deployment identity and discovers the service endpoint.
2. `PATCH /invocations/{invocation_id}/pause` pauses a running invocation while preserving progress.
3. `PATCH /invocations/{invocation_id}/resume?deployment=latest` explicitly resumes using the latest deployment identity.
4. The server source documents deployment replacement on resume and explicit errors for incompatible deployment selection/restart paths.

This is stronger than silently replacing an endpoint behind the same identity because the semantic/configuration identity change is explicit in Restate's durable control plane.

## Implemented experiment

Files:

- `research/chassis/adapters/restate-ts/t16-workflow-a.mjs`
- `research/chassis/adapters/restate-ts/t16-workflow-b.mjs`
- `research/chassis/adapters/restate-ts/t16-service-process.mjs`
- `research/chassis/adapters/restate-ts/t16-driver.mjs`
- `research/chassis/harness/t16-run-hook.mjs`
- `research/chassis/harness/restate-t16-profile.test.mjs`

The deterministic schedule is:

1. start endpoint deployment A;
2. register A through the Restate Admin API;
3. submit one workflow objective;
4. observe completion/replay of the durable `ctx.run('semantic-checkpoint', ...)` checkpoint under A;
5. pause the invocation;
6. start endpoint deployment B;
7. register B and require a distinct deployment ID;
8. explicitly resume the same invocation with `deployment=latest`;
9. inspect the final workflow result and output.

The two workflow variants deliberately preserve the same journal command name and canonical semantic result while changing deployment identity. Therefore a successful run is classified as `ROUTED_TO_COMPATIBLE`, not as an implicit migration or silent reinterpretation.

## T16 evidence mapping

The driver emits:

- `semanticMutation.dimension = deploymentId`
- `semanticMutation.before = deployment A id`
- `semanticMutation.after = deployment B id`
- `durableCheckpointBeforeMutation = true` only after the checkpoint event is observed under A
- `recoveryAttemptedUnderMutatedProfile = true` only after explicit resume targeting latest deployment
- `compatibilityDisposition.kind = ROUTED_TO_COMPATIBLE`
- `compatibilityDisposition.explicit = true` only when native resume succeeds
- `silentSemanticChangeObserved = false` only when canonical meaning remains unchanged
- `priorMeaningPreservedOrExplicitlyMigrated = true` only when final result preserves the canonical meaning
- `durableAuthorityAlive = true` only when final workflow output remains queryable

The common T16 evaluator and record bridge remain the verdict authority.

## Scientific boundary

This commit provides structural implementation and source-grounded mechanism evidence only.

It does **not** establish a candidate PASS because the exact Restate server/SDK runtime could not be executed in the current environment. The local attempt to acquire repository/runtime material remains blocked by DNS/network resolution, and candidate dependencies remain unavailable under B001.

The structural source test `restate-t16-profile.test.mjs` is versioned but not executed in this environment. It must not be reported as PASS until executed against the exact repository files.

## Remaining Restate critical gaps

After this slice, Restate still lacks declared formal executors for:

- T5 — concurrent worker ownership race
- T11 — cancel/crash/retry race
- T12 — stale completion after newer authority

T7 and T8 already use the common local-process slice. T16 now has a dedicated structural executor. Benchmark execution remains not ready.
