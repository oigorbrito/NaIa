# NaIA Planner-Authored Workflows and Automation Surface V1

Status: COMPLETE

## Goal

Turn provider-oriented natural requests into declarative workflow plans and introduce an explicit proposal/confirmation boundary before automation execution.

## Delivered

- deterministic natural-intent workflow authoring for GitHub, Gmail, and Google Calendar capabilities
- authored plans compile through the existing declarative workflow compiler
- authored plans retain `declarative=true`, `workflowId`, dependency edges, capability risk, and scopes
- new objective state: `WAITING_CONFIRMATION`
- `propose()` persists objective + plan without executing any step
- `confirm()` is the only transition from a proposal into execution
- `resume()` refuses to bypass confirmation
- proposal summary exposes steps, providers, risks, scopes, and write actions
- confirmation remains separate from side-effect approval: external/local writes still pass through the scoped approval policy after confirmation
- evidence events: `AUTOMATION_PROPOSED` and `AUTOMATION_CONFIRMED`
- CLI: `automate`, `proposal`, and `confirm`
- focused tests prove zero invocation before confirmation and preserved write approval after confirmation

## Safety boundary

Automation confirmation is not authorization for side effects. Confirmation accepts the workflow plan as the intended automation. Capability writes remain subject to the existing scoped approval policy.

## CLI

```text
npm run start:product -- automate <natural request>
npm run start:product -- proposal <objectiveId>
npm run start:product -- confirm <objectiveId>
```

## Current authoring scope

V1 deterministically recognizes provider-oriented sequential clauses and JSON action inputs. Rich semantic extraction, planner-authored conditions/transforms/fan-out, ambiguity handling, and LLM-backed planning remain maturity work behind the planner provider contract.

## Exit state

- `PLANNER_AUTHORED_WORKFLOWS_V1 = COMPLETE`
- `AUTOMATION_PROPOSAL_LIFECYCLE_V1 = COMPLETE`
- `PRE_EXECUTION_CONFIRMATION_GATE = COMPLETE`
- `WRITE_APPROVAL_AFTER_CONFIRMATION = PRESERVED`
- `AUTOMATION_PREVIEW_CLI = COMPLETE`
- `LLM_PLANNER = NOT_IMPLEMENTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`

## Next wave

Automation catalog, parameterized reusable templates, richer planner-authored graph constructs, and a user-oriented automation management surface.
