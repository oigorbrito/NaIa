# NaIA Connected Capabilities and Interaction V1

Date: 2026-09-03
Branch: `product/connected-interaction-v1`

## Goal

Extend the completed extensible capability layer with a real external connector boundary and a persistent interactive product surface without placing service credentials or provider-specific APIs inside NaIA Core.

## Delivered flow

`interactive intent -> connector-aware planner -> capability registry -> scoped policy -> connector gateway -> external service -> evidence -> persisted history`

## Connector gateway

NaIA can discover external capabilities from a gateway configured through:

- `NAIA_CONNECTOR_GATEWAY_URL`
- `NAIA_CONNECTOR_GATEWAY_TOKEN` (optional bearer token)

The gateway protocol is deliberately small.

### Discovery

`GET /capabilities`

Response may be either an array or `{ "capabilities": [...] }`. Each item must expose at least `name` and `risk`, with optional `scopes` and `description`.

Example:

```json
{
  "capabilities": [
    {
      "name": "github.issue.read",
      "risk": "READ_ONLY",
      "scopes": ["github:issues:read"],
      "description": "Read one GitHub issue"
    }
  ]
}
```

### Invocation

`POST /invoke`

NaIA sends:

```json
{
  "capability": "github.issue.read",
  "input": { "repository": "tihotm/NaIa", "issue": 4 },
  "context": { "objectiveId": "...", "stepId": "..." }
}
```

The response body is treated as the capability result and is preserved in execution evidence.

## Credential boundary

Credentials remain outside domain objects, plans and evidence. The product process only receives the gateway URL and optional gateway bearer token through environment configuration. Provider-specific credentials are expected to remain behind the gateway.

## Explicit capability intent

Connected capabilities can be invoked through an explicit deterministic intent:

```text
use github.issue.read {"repository":"tihotm/NaIa","issue":4}
```

The planner resolves the capability from the registry and derives risk/scopes from the discovered descriptor rather than trusting user-supplied risk metadata.

Non-`use` input continues through the existing deterministic planner.

## Interactive session

Run:

```bash
npm run session:product
```

Session commands:

- `/history`
- `/capabilities`
- `/status <objectiveId>`
- `/approve <objectiveId> <capability>`
- `/exit`

Any other line becomes a persisted NaIA objective.

## Tests

Focused tests cover:

- gateway capability discovery;
- bearer-token forwarding;
- gateway invocation;
- remote failure propagation;
- explicit capability intent parsing;
- registry-derived scope metadata;
- interactive command routing.

Product tests remain runnable with `npm test` and the previously defined Product CI workflow.

## Exit state

`CONNECTED_CAPABILITIES_V1 = COMPLETE`

`CONNECTOR_GATEWAY_CONTRACT = IMPLEMENTED`

`EXTERNAL_CAPABILITY_DISCOVERY = IMPLEMENTED`

`EXTERNAL_CAPABILITY_INVOCATION = IMPLEMENTED`

`CREDENTIAL_BOUNDARY = IMPLEMENTED_GATEWAY`

`CONNECTOR_AWARE_PLANNER = IMPLEMENTED`

`INTERACTIVE_SESSION = IMPLEMENTED`

`CONNECTED_PROVIDER_ADAPTERS = GATEWAY_SUPPLIED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`

## Next product block

Move from a generic gateway to first-class provider capability packs and richer interaction: connection state, provider-specific schemas, structured results, approval UX, and multi-step plans. Keep provider credentials outside the core and keep durable-execution selection separate.
