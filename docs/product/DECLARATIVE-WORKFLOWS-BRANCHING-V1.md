# NaIA Declarative Workflows and Branching V1

Status: COMPLETE

This block extends structured orchestration with declarative workflow definitions, conditional execution, transforms, fan-out/fan-in, DAG validation, and JSON workflow execution while preserving approval, connection, and persisted-result semantics.

## Declarative step kinds

- `ACTION`: invoke one registered capability.
- `CONDITION`: evaluate a result-aware predicate and mark the unselected branch `SKIPPED`.
- `TRANSFORM`: materialize a structured value/result without invoking an external capability.
- `FAN_OUT`: resolve an item list and expand one concrete execution step per item.
- `FAN_IN`: aggregate results from expanded fan-out children.

## References

Workflow definitions use source-local step ids. The compiler namespaces them by objective id and rewrites `$result` references automatically.

```json
{ "$result": { "stepId": "seed", "path": "priority" } }
```

Fan-out input templates can reference the current item:

```json
{ "$item": "email" }
```

## Runtime semantics

- workflow dependency cycles and unknown dependencies are rejected before execution;
- `SKIPPED` is a terminal dependency state, allowing joins after conditional branching;
- transforms, conditions, fan-out metadata, fan-in aggregates, and capability results are persisted as evidence;
- fan-out expansion mutates and persists the concrete plan so resume sees the same children;
- approval and provider-connection gates remain applied to every generated action child;
- completed producer/transform steps are not replayed after a pause;
- `concurrency` is part of the fan-out contract, but V1 schedules generated children deterministically/serially. Parallel scheduling is a later maturity step.

## CLI

```text
npm run start:product -- workflow:validate workflows/examples/parallel-uppercase.json
npm run start:product -- workflow:run workflows/examples/parallel-uppercase.json
npm run start:product -- workflow:run workflows/examples/conditional-note.json
npm run start:product -- results <objectiveId>
```

## Examples

- `workflows/examples/parallel-uppercase.json`: transform -> fan-out -> fan-in using `text.uppercase`.
- `workflows/examples/conditional-note.json`: transform -> condition -> selected local-write branch with normal approval semantics.

## Focused test coverage

`test/product/declarative-workflows.test.mjs` covers:

- selected/unselected condition branches;
- `SKIPPED` branch semantics;
- transform -> fan-out -> fan-in composition;
- result aggregation;
- external-write approval inside generated fan-out children;
- resume without transform replay;
- workflow dependency cycle rejection.

## Exit state

`DECLARATIVE_WORKFLOWS_V1 = COMPLETE`

`CONDITIONAL_BRANCHING_V1 = COMPLETE`

`TRANSFORM_STEPS_V1 = COMPLETE`

`FAN_OUT_EXPANSION_V1 = COMPLETE`

`FAN_IN_AGGREGATION_V1 = COMPLETE`

`WORKFLOW_JSON_CLI = COMPLETE`

`PARALLEL_FAN_OUT_SCHEDULING = NOT_IMPLEMENTED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`

## Next product block

Add planner-authored workflow graphs, named outputs/transforms, workflow visualization, and a higher-level execution surface so users do not need to author raw JSON for common automations.
