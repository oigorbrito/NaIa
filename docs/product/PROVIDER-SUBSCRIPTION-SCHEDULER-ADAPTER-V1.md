# Provider Subscription Lifecycle and Scheduler Adapter V1

Status: COMPLETE

This wave adds the control-plane contracts needed to keep external webhook/watch/channel registrations alive and to connect NaIA schedule automations to an external scheduler without embedding a scheduler or chassis in NaIA Core.

## Delivered

- provider subscription store (memory and file-backed)
- subscription lifecycle states: `ACTIVE`, `EXPIRING`, `STOPPED`, `FAILED`
- idempotent `ensure` semantics per provider + automation
- provider adapter contract: `create`, `renew`, `stop`
- canonical GitHub webhook, Gmail watch, and Google Calendar channel adapter constructors
- expiration-window detection for renewal workflows
- file persistence at `.naia/provider-subscriptions.json`
- external scheduler adapter contract: `register`, `unregister`, `list`
- in-memory scheduler adapter for deterministic tests
- scheduler bridge that synchronizes enabled `SCHEDULE` automations
- stale-registration cleanup
- schedule occurrence callback that feeds the existing `ScheduleSource`
- replay protection remains delegated to trigger-runtime idempotency

## Boundaries

NaIA Core does not call GitHub/Gmail/Calendar REST APIs directly from this lifecycle module. Provider credentials and API clients are supplied through provider subscription adapters.

The scheduler bridge does not parse cron, advance time, poll clocks, or decide when an occurrence is due. It registers schedule metadata with an external scheduler and consumes resolved occurrences (`automationId`, `scheduledFor`).

Every occurrence still becomes a trigger delivery, then a fresh `WAITING_CONFIRMATION` objective. Confirmation, connection state, and scoped write approval remain downstream gates.

## Exit state

- `PROVIDER_SUBSCRIPTION_STORE_V1 = COMPLETE`
- `PROVIDER_SUBSCRIPTION_LIFECYCLE_V1 = COMPLETE`
- `GITHUB_WEBHOOK_SUBSCRIPTION_ADAPTER_CONTRACT = COMPLETE`
- `GMAIL_WATCH_ADAPTER_CONTRACT = COMPLETE`
- `CALENDAR_CHANNEL_ADAPTER_CONTRACT = COMPLETE`
- `SUBSCRIPTION_RENEWAL_WINDOW_V1 = COMPLETE`
- `EXTERNAL_SCHEDULER_ADAPTER_V1 = COMPLETE`
- `SCHEDULER_SYNC_BRIDGE_V1 = COMPLETE`
- `SCHEDULE_OCCURRENCE_CALLBACK_V1 = COMPLETE`
- `LIVE_PROVIDER_SUBSCRIPTION_CALLS = NOT_VERIFIED`
- `EMBEDDED_SCHEDULER = NOT_IMPLEMENTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`
