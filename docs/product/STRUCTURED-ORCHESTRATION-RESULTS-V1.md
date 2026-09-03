# NaIA Structured Orchestration and Result References V1

Status: COMPLETE

This block upgrades provider-aware sequential plans into structured orchestration with explicit step dependencies and persisted result references.

## Delivered

- `dependsOn` step dependencies with validation against missing and forward dependencies.
- Structured result reference contract: `{ "$result": { "stepId": "...", "path": "..." } }`.
- Recursive result-reference resolution inside nested input objects and arrays.
- `STEP_RESULT` evidence persisted independently from execution transport output.
- Result-store reconstruction from evidence during resume.
- Downstream input resolution immediately before execution.
- `BLOCKED_DEPENDENCY` / `DEPENDENCY_BLOCKED` semantics for invalid runtime dependency state.
- Provider-aware planner emits sequential dependency edges.
- External-write approval remains after upstream read/transform work and does not replay completed producer steps.
- CLI `results <objectiveId>` exposes persisted step outputs.
- Focused tests for output-to-input composition, resume without producer replay, and dependency validation.

## Result reference

A planner may bind a downstream input to an earlier step result:

```json
{
  "body": {
    "$result": {
      "stepId": "objective:github-read",
      "path": "body"
    }
  }
}
```

References may only target earlier steps. Missing steps, forward references, and missing result paths fail before the downstream capability is invoked.

## Resume semantics

Completed steps remain completed. Their results are reconstructed from `STEP_RESULT` evidence. If a later step pauses for provider connection or user approval, resuming resolves the downstream references from persisted upstream results rather than invoking the producer again.

## Exit state

`STRUCTURED_ORCHESTRATION_V1 = COMPLETE`

`RESULT_REFERENCES_V1 = COMPLETE`

`PERSISTED_STEP_RESULTS = COMPLETE`

`DEPENDENCY_VALIDATION = COMPLETE`

`RESUME_WITHOUT_PRODUCER_REPLAY = COMPLETE`

`CROSS_PROVIDER_DATA_BINDING_CONTRACT = IMPLEMENTED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`

## Next wave

The next product block should add declarative workflow templates and richer planner-produced bindings, including named outputs, transformations, conditional routing, and fan-out/fan-in while preserving the existing connection, policy, evidence, and resume boundaries.
