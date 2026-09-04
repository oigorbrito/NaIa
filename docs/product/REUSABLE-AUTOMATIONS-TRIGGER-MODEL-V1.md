# NaIA Reusable Automations and Trigger Model V1

Status: COMPLETE

This block turns one-off confirmed workflow proposals into reusable persisted automation definitions while keeping execution policy separate from trigger description and from the future durable execution chassis.

## Delivered

- persisted reusable automation definitions in `.naia/automations.json`
- automation identity, name, description, enabled state, parameters, trigger, and declarative workflow
- trigger kinds `MANUAL`, `SCHEDULE`, and `EVENT`
- strict parameter resolution through `$param`
- enable/disable lifecycle
- manual and external trigger entry points
- trigger validation, including event identity
- each automation run creates a fresh objective and compiled workflow plan
- every run starts in `WAITING_CONFIRMATION`
- trigger firing does not bypass confirmation, connection checks, or scoped write approval
- CLI commands for create/list/show/enable/disable/run/trigger
- versioned automation example
- focused lifecycle, parameter, trigger, and confirmation tests

## Execution boundary

The trigger model is descriptive. This V1 does not embed a scheduler, webhook server, queue, or chassis-specific timer implementation in NaIA Core. A future trigger adapter can call `triggerAutomation()` when a schedule or event fires. Durable scheduling/execution remains behind a separate adapter boundary.

## CLI

```text
npm run start:product -- automation:create automations/examples/daily-uppercase.json
npm run start:product -- automations
npm run start:product -- automation:enable daily-uppercase
npm run start:product -- automation:run daily-uppercase '{"text":"naia"}'
npm run start:product -- automation:trigger daily-uppercase '{"kind":"SCHEDULE"}' '{"text":"naia"}'
npm run start:product -- confirm <objectiveId>
```

## CI note

The preceding Product CI run and its failed-job rerun both terminated without exposed job steps (`steps=null`), and job-log retrieval returned `BlobNotFound`. No product test command was observed running, so this is recorded as pre-runner/infrastructure failure rather than a code-test failure. Runtime test success is not claimed here.

## Exit state

- `REUSABLE_AUTOMATION_DEFINITION_V1 = COMPLETE`
- `AUTOMATION_PERSISTENCE_V1 = COMPLETE`
- `AUTOMATION_PARAMETER_BINDING_V1 = COMPLETE`
- `AUTOMATION_ENABLE_DISABLE_V1 = COMPLETE`
- `TRIGGER_MODEL_V1 = COMPLETE`
- `MANUAL_TRIGGER_CONTRACT = COMPLETE`
- `SCHEDULE_TRIGGER_CONTRACT = COMPLETE`
- `EVENT_TRIGGER_CONTRACT = COMPLETE`
- `TRIGGER_TO_CONFIRMATION_PIPELINE = COMPLETE`
- `EMBEDDED_SCHEDULER = NOT_IMPLEMENTED`
- `EVENT_INGRESS_SERVER = NOT_IMPLEMENTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`

## Next block

`TRIGGER_ADAPTERS_AND_AUTOMATION_RUN_HISTORY`

Next product work should add trigger-adapter ports, automation-specific run history/observability, idempotency keys for external trigger delivery, and a scheduler/event adapter contract that can later be backed by the selected durable chassis without changing automation definitions.
