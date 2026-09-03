# NaIA Extensible Capability Layer V1

Date: 2026-09-03
Branch: `product/extensible-capability-layer-v1`

## Goal

Replace the first useful capability's hard-wired planning/tool metadata with stable extension contracts while preserving the completed product foundation and keeping durable execution replaceable.

## Delivered architecture

`objective -> planner provider -> capability action -> scoped policy -> execution adapter -> evidence -> presenter`

### Capability contract

Capabilities now declare:

- stable `name`;
- `risk` (`READ_ONLY`, `LOCAL_WRITE`, `EXTERNAL_WRITE`);
- explicit permission `scopes`;
- human description and source metadata;
- an `invoke(input, context)` adapter boundary.

The registry accepts injected capabilities without changes to the service or execution orchestration.

### Planner provider contract

Planner implementations are injected behind a provider and their result is validated before execution. Plans must target the objective, contain valid steps, and actions must identify a capability/risk/scopes.

The deterministic planner remains the default adapter but now derives action risk and scopes from capability metadata instead of owning those decisions.

### Scoped authorization

Approvals are persisted as capability grants with scopes. Side effects are authorized only when the persisted approval covers the scopes requested by the planned action.

Legacy `TOOL_APPROVED` evidence remains compatible while carrying `capability` and `scopes` fields.

### Adapter composition

`createFilePorts(...)` accepts:

- injected capabilities;
- an injected planner provider;
- the existing replaceable execution boundary.

This allows future external capability adapters and richer planners to enter without rewriting objective, evidence, persistence, recovery, or policy orchestration.

### Presentation

A presenter provides a concise objective view containing current state, current step/capability, approvals, evidence count, last event, and update time. CLI adds `status <objectiveId>`.

## Verification assets

Focused tests cover:

- injected capability registration and invocation;
- planner provider validation;
- scoped write approval;
- persisted approval semantics;
- concise presenter output;
- compatibility with the previous tool catalog/event surface.

Product CI already executes all `test/product/*.test.mjs` on Node 22 when the runner is available.

## Exit state

`CAPABILITY_CONTRACT = IMPLEMENTED`

`CAPABILITY_REGISTRY = EXTENSIBLE`

`PLANNER_PROVIDER_CONTRACT = IMPLEMENTED`

`PLANNER_OUTPUT_VALIDATION = IMPLEMENTED`

`SCOPED_POLICY = IMPLEMENTED`

`INJECTABLE_CAPABILITY_ADAPTERS = IMPLEMENTED`

`USER_PRESENTATION = IMPLEMENTED_CLI_STATUS`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`EXTENSIBLE_CAPABILITY_LAYER_V1 = COMPLETE`

## Next product block

Build connected capabilities and richer planning on these contracts: external account/tool adapters, explicit credential/connection boundaries, richer planning decisions, and a user-facing interaction surface. Durable chassis integration remains behind the execution port and chassis winner selection remains a separate research decision.
