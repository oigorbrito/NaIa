# NaIA First Useful Capability V1

Date: 2026-09-03
Branch: `product/mvp-foundation-v1`

## Goal

Deliver a complete local product path that accepts user intent, produces an actionable plan, selects a tool, enforces an authorization boundary for side effects, invokes the tool, records evidence, persists state, and exposes objective history.

## Delivered flow

`intent -> planner -> tool selection -> policy -> execution -> evidence -> persisted objective/history`

## Supported local intents

- `time` / time-like intent -> `time.now` (`READ_ONLY`)
- `uppercase: <text>` -> `text.uppercase` (`READ_ONLY`)
- unmatched text -> `text.echo` (`READ_ONLY`)
- `note <name>: <content>` -> `note.write` (`LOCAL_WRITE`, explicit approval required)

## Authorization semantics

Read-only tools execute without an approval ceremony. A tool marked `LOCAL_WRITE` is stopped before invocation when approval is absent.

The objective enters `WAITING_APPROVAL`, the action step enters `AWAITING_APPROVAL`, and an `APPROVAL_REQUIRED` evidence record is appended. This is not treated as execution failure.

Approval is explicit and scoped to the tool in the persisted objective:

```bash
npm run start:product -- approve <objectiveId> note.write
```

The approval is evidenced as `TOOL_APPROVED`, then execution resumes from the unfinished action instead of replaying completed steps.

## Real local tools

The local registry currently includes:

- `time.now`
- `text.uppercase`
- `text.echo`
- `note.write`

`note.write` writes to `.naia/workspace/notes/<safe-name>.txt`. Note names are sanitized before filesystem use.

## CLI

```bash
npm run start:product -- tools
npm run start:product -- pursue "uppercase: hello naia"
npm run start:product -- pursue "note release-plan: ship capability"
npm run start:product -- approve <objectiveId> note.write
npm run start:product -- show <objectiveId>
npm run start:product -- resume <objectiveId>
npm run start:product -- history
```

## Evidence

The execution path records at least:

- `OBJECTIVE_CREATED`
- `PLAN_CREATED`
- `STEP_STARTED`
- `STEP_EXECUTED`
- `APPROVAL_REQUIRED` when applicable
- `TOOL_APPROVED` when applicable
- `OBJECTIVE_RESUMED` when applicable
- `OBJECTIVE_COMPLETED`

Evidence remains append-only JSONL under `.naia/evidence.jsonl`.

## Verification assets

Focused product tests cover:

- read-only intent planning and real tool invocation;
- tool output preserved in evidence;
- execution failure and resume from the unfinished step;
- write action blocked before approval;
- explicit tool approval and subsequent write;
- cross-instance persisted state/history;
- tool risk catalog.

A dedicated `.github/workflows/product-ci.yml` runs `npm test` for product changes on Node 22.

The current execution environment used by this session could not clone GitHub because DNS resolution for `github.com` failed before code execution. This does not alter the product block state; it means runtime execution of the committed tests remains a maturity check rather than a product-development gate.

## Exit state

`FIRST_USEFUL_CAPABILITY_V1 = COMPLETE`

`INTENT_TO_ACTIONABLE_PLAN = IMPLEMENTED`

`TOOL_SELECTION = IMPLEMENTED`

`TOOL_REGISTRY = IMPLEMENTED`

`READ_ONLY_TOOL_EXECUTION = IMPLEMENTED`

`SIDE_EFFECT_AUTHORIZATION = IMPLEMENTED`

`LOCAL_WRITE_TOOL_EXECUTION = IMPLEMENTED`

`EVIDENCE_RENDERING = IMPLEMENTED_JSON`

`OBJECTIVE_HISTORY = IMPLEMENTED`

`PRODUCT_CI = DEFINED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

## Next product block

Move from deterministic local intent parsing to an extensible capability layer: richer planner input/output contracts, external tool adapters, policy scopes, user-facing presentation, and durable execution integration behind the existing ports. Chassis winner selection remains separate.
