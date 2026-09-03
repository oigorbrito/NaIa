# NaIA First-Class Provider Capability Packs V1

Date: 2026-09-03

## Goal

Turn the provider-neutral connector boundary into stable first-class capability packs for GitHub, Gmail, and Google Calendar without embedding provider credentials or SDK dependencies in NaIA Core.

## Delivered packs

### `github.core`

- `github.issue.read` — `READ_ONLY` — `github:issues:read`
- `github.issue.create` — `EXTERNAL_WRITE` — `github:issues:write`
- `github.pull_request.read` — `READ_ONLY` — `github:pull_requests:read`

### `gmail.core`

- `gmail.message.search` — `READ_ONLY` — `gmail:messages:read`
- `gmail.message.read` — `READ_ONLY` — `gmail:messages:read`
- `gmail.message.send` — `EXTERNAL_WRITE` — `gmail:messages:send`

### `google-calendar.core`

- `calendar.events.list` — `READ_ONLY` — `calendar:events:read`
- `calendar.free_busy.read` — `READ_ONLY` — `calendar:free_busy:read`
- `calendar.event.create` — `EXTERNAL_WRITE` — `calendar:events:write`

## Contracts

Each provider capability now has a stable provider, pack id, pack version, risk class, permission scopes, description, and inspectable input schema.

Input schemas are enforced inside NaIA before an invocation reaches the connector gateway. This prevents malformed writes and prevents arbitrary extra fields such as credential material from being forwarded accidentally.

The provider pack gateway adapter still delegates actual provider execution to the connector gateway. Provider credentials therefore remain outside NaIA Core.

## Manifest compatibility

`assertProviderCapabilityManifest(...)` compares gateway-advertised capabilities with the NaIA provider pack contract. It detects:

- capability missing from the gateway;
- risk-class drift;
- missing required scopes.

This lets connection setup and future UI distinguish a provider that is connected from one that is contract-compatible.

## Verification assets

Focused tests cover:

- GitHub/Gmail/Calendar pack discovery;
- malformed external-write rejection;
- date-time and unknown-field validation;
- provider invocation through the existing connector gateway;
- manifest compatibility and scope drift;
- schema inspection for planner/UI surfaces.

## Exit state

`FIRST_CLASS_PROVIDER_CAPABILITY_PACKS_V1 = COMPLETE`

`GITHUB_CORE_PACK = IMPLEMENTED`

`GMAIL_CORE_PACK = IMPLEMENTED`

`GOOGLE_CALENDAR_CORE_PACK = IMPLEMENTED`

`PROVIDER_INPUT_SCHEMA_VALIDATION = IMPLEMENTED`

`GATEWAY_MANIFEST_COMPATIBILITY = IMPLEMENTED`

`PROVIDER_CREDENTIALS_IN_CORE = NONE`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

## Next product block

Build connection-state and provider-aware planning on top of these packs: connected/disconnected/permission-missing state, capability availability filtering, provider-aware natural-language planning, and multi-step objectives that combine read and write capabilities while preserving approval boundaries.
