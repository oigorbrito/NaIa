# NaIA Provider Event V1

Status: IMPLEMENTED_PENDING_LIVE_PROVIDER

## Purpose

Accept a real external provider event over HTTP and feed it into the existing NaIA trigger runtime without bypassing authentication, confirmation, idempotency, evidence, or persistence.

GitHub is the first provider protocol because its `X-Hub-Signature-256` header uses the same HMAC SHA-256 wire format already supported by NaIA.

## Runtime

Start the server with:

```powershell
$env:NAIA_GITHUB_WEBHOOK_SECRET = '<shared secret>'
$env:NAIA_GITHUB_WEBHOOK_AUTOMATION_ID = 'github-provider-event'
$env:NAIA_GITHUB_WEBHOOK_EVENT = 'push'
$env:NAIA_GITHUB_WEBHOOK_INTENT = 'uppercase: provider event received'
$env:NAIA_GITHUB_WEBHOOK_HOST = '127.0.0.1'
$env:NAIA_GITHUB_WEBHOOK_PORT = '8788'
npm run webhook:github
```

Default route:

```text
POST /webhook/github
```

Headers:

```text
X-Hub-Signature-256
X-GitHub-Delivery
X-GitHub-Event
```

The raw request body is passed unchanged to the existing trigger authentication path.

## Safety invariants

- invalid HMAC returns 401 and creates no objective;
- unexpected event type returns 422 and creates no objective;
- malformed JSON fails closed;
- request body is bounded before trigger processing;
- repeated `X-GitHub-Delivery` values reuse the same objective through the existing idempotency key;
- provider event objectives remain `WAITING_CONFIRMATION` until explicitly confirmed;
- webhook secret is runtime-only and is never written to objective, plan, or evidence state.

## Deterministic gates

- PROVIDER-EVENT-01 valid webhook creates a confirmable objective.
- PROVIDER-EVENT-02 replay deduplicates by delivery id.
- PROVIDER-EVENT-03 invalid signature fails without side effects.
- PROVIDER-EVENT-04 event mismatch fails without side effects.
- PROVIDER-EVENT-05 oversized body fails before objective creation.
- PROVIDER-EVENT-06 webhook secret is absent from file-backed persistence.

## Suite target

```text
61 prior product tests
+ 6 provider event tests
= 67 tests
```

Acceptance target: `tests 67 / pass 67 / fail 0`.

## Live provider E2E

The deterministic network tests prove the ingress implementation. The historical MVP `real provider event E2E` gate still requires one actual GitHub webhook delivery from GitHub infrastructure to a publicly reachable instance of this endpoint, followed by confirmation of the persisted NaIA objective.

Until that delivery is observed, `LIVE_PROVIDER_EVENT = BLOCKED_EXTERNAL`; this does not invalidate the local ingress contracts.
