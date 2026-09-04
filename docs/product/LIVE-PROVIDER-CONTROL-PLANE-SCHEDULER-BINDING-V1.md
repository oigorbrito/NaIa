# LIVE_PROVIDER_CONTROL_PLANE_AND_SCHEDULER_BINDING_V1

Status: COMPLETE

This wave binds the previously abstract provider subscription lifecycle to concrete REST clients for GitHub, Gmail, and Google Calendar, and binds schedule registrations to an external HTTP scheduler protocol.

## Delivered

- GitHub webhook control client using GitHub REST webhook create/update/delete endpoints.
- Gmail watch control client using Gmail `users.watch` and `users.stop` endpoints.
- Google Calendar channel control client using `events.watch` and `channels.stop` endpoints.
- Live provider adapter composition for the existing provider subscription manager.
- External HTTP scheduler adapter using register/list/unregister operations.
- Authenticated scheduler occurrence callback ingress.
- Focused tests for provider request mapping, secret non-persistence, scheduler registration, and occurrence forwarding.

## Security boundary

Provider credentials and webhook/channel secrets are captured by the live clients and are not returned in subscription metadata. They therefore do not need to be persisted in `provider-subscriptions.json` by the control plane.

GitHub webhook secrets are used only in the remote webhook configuration request. Gmail and Calendar access tokens are used only in Authorization headers. Calendar channel tokens are used only when creating the remote channel.

## Provider lifecycle

The existing subscription manager remains authoritative for local lifecycle state:

- `ACTIVE`
- `EXPIRING`
- `STOPPED`
- `FAILED`

The new live clients provide the remote side of `create`, `renew`, and `stop` without moving provider API details into NaIA Core.

## Scheduler binding

The HTTP scheduler adapter implements the existing scheduler contract:

- `register`
- `unregister`
- `list`

Registration sends `automationId`, schedule expression, timezone, callback URL, and non-secret metadata to an external scheduler service.

The callback ingress accepts a resolved occurrence containing `automationId` and `scheduledFor`, authenticates it using a bearer token, and forwards it to `SchedulerBridge.occurrence`. It does not interpret cron or choose execution time.

## Architectural boundary

This wave does not select or embed a durable execution chassis. A scheduler service can later be backed by Temporal, DBOS, Restate, Trigger.dev, a managed cron system, or another implementation without changing NaIA Core semantics.

Remote provider calls are implemented and testable through injected `fetch`, but no claim is made that live credentials were exercised against production provider accounts in this wave.

## Exit state

`LIVE_GITHUB_WEBHOOK_CONTROL_CLIENT_V1 = COMPLETE`

`LIVE_GMAIL_WATCH_CONTROL_CLIENT_V1 = COMPLETE`

`LIVE_CALENDAR_CHANNEL_CONTROL_CLIENT_V1 = COMPLETE`

`LIVE_PROVIDER_ADAPTER_COMPOSITION_V1 = COMPLETE`

`HTTP_SCHEDULER_ADAPTER_V1 = COMPLETE`

`SCHEDULER_CALLBACK_INGRESS_V1 = COMPLETE`

`PROVIDER_CREDENTIAL_NON_PERSISTENCE = PRESERVED`

`LIVE_PROVIDER_ACCOUNT_VERIFICATION = NOT_EXECUTED`

`CONCRETE_DURABLE_SCHEDULER_VENDOR = NOT_SELECTED`

`DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`

`CHASSIS_WINNER = NOT_SELECTED`
