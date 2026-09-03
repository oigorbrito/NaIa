# NaIA Connection State and Provider-Aware Planning V1

Status: COMPLETE

This block adds explicit provider connection state, permission-aware capability availability, and multi-step provider-aware planning on top of the completed first-class provider capability packs.

## Delivered

- provider connection states: `CONNECTED`, `DISCONNECTED`, `PERMISSION_MISSING`;
- persisted provider state under `.naia/connections.json`;
- capability availability derived from provider state and granted scopes;
- `WAITING_CONNECTION` objective state and `BLOCKED_CONNECTION` step state;
- `CONNECTION_REQUIRED` and `CONNECTION_STATE_CHANGED` evidence;
- execution that stops before invoking unavailable provider capabilities;
- resume semantics that re-evaluate provider availability and continue after connection repair;
- provider-aware natural-language clause routing for GitHub, Gmail, and Calendar;
- multi-step plans across providers while preserving write approval boundaries;
- CLI commands `connections` and `connection:set`;
- canonical provider capability registration through the connector gateway when manifest metadata is compatible;
- focused tests for disconnected providers, missing scopes, persistence, resume, and multi-provider execution.

## Example lifecycle

```text
objective
  -> github.issue.read
  -> gmail.message.send

GitHub disconnected
  -> WAITING_CONNECTION
  -> connection:set github CONNECTED github:issues:read
  -> resume
  -> GitHub read executes
  -> Gmail write reaches WAITING_APPROVAL
  -> approve gmail.message.send
  -> Gmail send executes
  -> COMPLETED
```

## Connection commands

```bash
npm run start:product -- connections
npm run start:product -- connection:set github CONNECTED github:issues:read,github:issues:write
npm run start:product -- connection:set gmail PERMISSION_MISSING gmail:messages:send
npm run start:product -- connection:set google-calendar DISCONNECTED
```

## Exit state

`CONNECTION_STATE_MODEL_V1 = COMPLETE`

`PERMISSION_AWARE_AVAILABILITY = COMPLETE`

`WAITING_CONNECTION_SEMANTICS = COMPLETE`

`PROVIDER_AWARE_MULTI_STEP_PLANNING_V1 = COMPLETE`

`MULTI_PROVIDER_RESUME = COMPLETE`

`EXTERNAL_WRITE_APPROVAL_BOUNDARY = PRESERVED`

`RUNTIME_PROVIDER_CONNECTION = ENVIRONMENT_DEPENDENT`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

## Next block

Build connection lifecycle automation and richer orchestration: gateway-derived connection health, reconnect/permission repair guidance, structured multi-step dependency passing, provider result references, and a higher-level user interaction surface. Chassis selection remains separate.
