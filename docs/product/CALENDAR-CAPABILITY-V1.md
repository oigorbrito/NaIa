# NaIA Calendar Capability V1

Status: IMPLEMENTED_PENDING_LOCAL_REPRO

## Goal

Add the first secretary-oriented capability on top of the extensible execution layer: calendar reading and controlled calendar mutation.

The NaIA owns intent resolution, policy, approval, evidence, retry disposition, and persistence. A calendar provider owns only provider-specific transport/authentication.

## Tools

- `calendar.list` — READ_ONLY, no approval.
- `calendar.create` — EXTERNAL_WRITE, explicit approval required.
- `calendar.update` — EXTERNAL_WRITE, explicit approval required.

## Deterministic intents for V1

```text
calendar list <from> | <to>
calendar create <start> | <end> | <title>
calendar update <eventId> | <start> | <end> | <title>
```

The deterministic grammar is a reproducible product fixture, not the final conversational UX. Natural-language interpretation can sit above it later without changing the policy/execution contract.

## Approval scopes

Create approval scope is `calendar:create`.

Update approval scope is bound to the event identity: `calendar:update:<eventId>`.

An approval for one event must not authorize another event or a mutated action.

## Provider contract

A provider exposes:

```js
{
  async list({ from, to }) {},
  async create({ start, end, title }) {},
  async update({ eventId, start, end, title }) {}
}
```

Credentials are construction-time/runtime provider state. They must never be copied into objective titles, plans, action inputs, or evidence.

## HTTP provider V1

The generic HTTP provider is configured with a fixed `baseUrl` and optional bearer token held only in memory.

Transport contract:

- `GET /events?from=<iso>&to=<iso>`
- `POST /events` JSON body `{ start, end, title }`
- `PATCH /events/<eventId>` JSON body `{ start, end, title }`

Redirects are not followed. Cross-origin movement is therefore impossible inside this provider transport. Response bodies are bounded and timeouts abort the request.

Runtime configuration:

```text
NAIA_CALENDAR_BASE_URL
NAIA_CALENDAR_TOKEN            optional bearer token
NAIA_CALENDAR_TIMEOUT_MS       optional, default 5000
NAIA_CALENDAR_MAX_BYTES        optional, default 262144
```

When `NAIA_CALENDAR_BASE_URL` is absent, calendar capabilities are not registered and default product behavior is unchanged.

## Gates implemented

- CAL-01 list is read-only and completes without approval.
- CAL-02 create stops before provider dispatch.
- CAL-03 correct create approval dispatches exactly once.
- CAL-04 update approval is event-scoped and does not transfer.
- CAL-05 malformed date ranges fail before provider dispatch.
- CAL-06 provider token is never persisted/evidenced.
- CAL-07 HTTP 5xx is retryable; 4xx is permanent.
- CAL-08 timeout never becomes success.
- CAL-09 default runtime remains unchanged when calendar config is absent.
- CAL-10 configured runtime exposes calendar capabilities without exposing token metadata.

## Reproduction gate

Aggregate expected suite on this branch:

```text
35 prior product tests
+ 10 calendar contracts
= 45 tests
```

Acceptance is `tests 45 / pass 45 / fail 0` in the local supported Node environment. Until observed, this block remains `IMPLEMENTED_PENDING_LOCAL_REPRO` rather than PASS.
