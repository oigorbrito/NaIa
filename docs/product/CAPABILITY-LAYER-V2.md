# NaIA Capability Layer V2

Date: 2026-09-11
Branch: `product/mvp-capability-layer-v2`
Base: `product/mvp-foundation-v1` (`a8baae9`)

## Purpose

Implement the next documented product block without selecting a chassis winner or coupling the MVP to OpenManus.

The capability layer keeps the existing product path:

`intent -> plan -> policy -> execution -> evidence -> persisted state`

while making planning and execution extensible.

## Delivered changes

### Capability registry

`src/product/capabilities.mjs`

Capabilities now provide:

- stable capability id;
- intent matcher;
- action builder;
- explicit tool, risk and approval metadata.

Resolution is fail-closed:

- zero matches -> `UNSUPPORTED_INTENT`;
- multiple matches -> `AMBIGUOUS_INTENT`.

Default behavior remains compatible with the foundation intents:

- current time -> `time.now`;
- uppercase -> `text.uppercase`;
- note write -> `note.write`.

### Capability planner

`src/product/planner.mjs`

The planner now consumes a capability registry instead of embedding intent-specific branching in the planner itself.

Plans include `capabilityId` as evidence of which capability produced the action.

### Extensible local tool registry

`src/product/tools.mjs`

The tool registry now supports validated dynamic registration while preserving the existing built-in tools.

Duplicate tool names fail closed.

### External execution router

`src/product/execution-router.mjs`

Execution can be delegated to external adapters without modifying NaIA service semantics.

Rules:

- local registered tools execute locally;
- exactly one matching external adapter may handle an external tool;
- zero matches -> permanent fail-closed error;
- multiple matches -> permanent fail-closed error;
- adapters must return an explicit `{ ok: boolean }` result.

### Scoped approvals

Approvals remain backward compatible.

Legacy approval token:

`note.write`

Scoped approval token:

`external.send::channel:alpha`

A capability may declare `approvalScope`. The service rejects an approval request whose supplied scope differs from the scope declared in the persisted plan.

### File and in-memory ports

Both port factories now accept:

- capability registry injection;
- additional local tools;
- external execution adapters.

Restart/persistence semantics therefore use the same capability/execution contracts as in-memory tests.

### Presentation

The service exposes `capabilities()` and the CLI adds:

```bash
npm run start:product -- capabilities
```

Scoped approval is available as:

```bash
npm run start:product -- approve <objectiveId> <tool> [scope]
```

Existing CLI commands remain valid.

## Added verification

`test/product/capability-layer.test.mjs` adds seven contracts:

1. custom capability + custom local tool;
2. ambiguous intent fails closed;
3. duplicate tool registration fails closed;
4. external execution adapter works without local tool registration;
5. missing external adapter fails permanently;
6. multiple external adapters for one tool fail closed;
7. scoped approval rejects the wrong scope and allows the declared scope exactly once.

The branch therefore expects:

- 18 pre-existing product tests;
- 7 new capability-layer tests;
- **25 total tests** under `npm test`.

## CI observation

GitHub Actions Product CI and a temporary diagnostic workflow both failed in the repository's current Actions environment before usable logs/artifacts could be retrieved. A review of recent workflow history also showed repeated failures across unrelated branches.

Classification:

`REMOTE_CI = BLOCKED_EXTERNAL / NOT_VALIDLY_MEASURED`

This is not counted as a PASS or as a product-code FAIL.

The temporary diagnostic workflow was removed after the observation.

## Required local reproduction

```powershell
cd C:\Projetos\naia
git fetch origin
git checkout product/mvp-capability-layer-v2
git pull origin product/mvp-capability-layer-v2
npm test
```

Acceptance target:

```text
tests 25
pass 25
fail 0
```

## Product state

`CAPABILITY_REGISTRY = IMPLEMENTED`

`EXTENSIBLE_PLANNER = IMPLEMENTED`

`DYNAMIC_LOCAL_TOOLS = IMPLEMENTED`

`EXTERNAL_EXECUTION_ROUTER = IMPLEMENTED`

`SCOPED_APPROVAL = IMPLEMENTED`

`CAPABILITY_PRESENTATION = IMPLEMENTED`

`LOCAL_REPRODUCTION = NOT_EXECUTED`

`REMOTE_CI = BLOCKED_EXTERNAL`

`CHASSIS_WINNER = UNCHANGED / NOT_SELECTED_BY_THIS_BLOCK`
