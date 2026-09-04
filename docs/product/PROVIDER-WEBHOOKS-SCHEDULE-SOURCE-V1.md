# Provider Webhooks and Schedule Source V1

Status: COMPLETE

This wave adds provider-specific webhook normalization and a chassis-independent schedule occurrence source on top of the existing authenticated trigger ingress and idempotent automation runtime.

## Delivered

- GitHub webhook adapter
  - validates `X-Hub-Signature-256`
  - reads `X-GitHub-Event`
  - reads `X-GitHub-Delivery`
  - derives stable event/idempotency identity
- Gmail push adapter
  - normalizes Google Pub/Sub push envelope
  - decodes `message.data` as base64 JSON
  - uses Pub/Sub `messageId` as stable delivery identity
  - authentication remains an external ingress concern
- Google Calendar webhook adapter
  - normalizes `X-Goog-Channel-ID`
  - normalizes `X-Goog-Resource-ID`
  - normalizes `X-Goog-Resource-State`
  - normalizes `X-Goog-Message-Number`
  - derives stable event/idempotency identity
  - authentication remains an external ingress concern
- provider webhook ingress facade
- provider HTTP router at `/webhooks/{provider}/{automationId}`
- schedule source adapter
  - accepts already-resolved `scheduledFor` occurrences
  - emits deterministic idempotency key `schedule:{automationId}:{scheduledFor}`
  - can emit occurrences for all enabled schedule-triggered automations
  - deliberately does not parse cron or act as an embedded scheduler
- focused tests for provider normalization, authentication boundary, deduplication, HTTP routing, and schedule replay suppression

## Safety boundary

Provider webhooks and schedule occurrences never invoke capabilities directly. They produce normalized trigger deliveries which pass through idempotency and create fresh objectives in `WAITING_CONFIRMATION`. Connection and scoped write approval remain downstream gates.

## Architectural boundary

The schedule source is not a scheduler. A future Temporal/DBOS/Restate/cron/cloud scheduler adapter can resolve due times and call `emitOccurrence` without changing NaIA Core.

Likewise, provider webhook verification is provider-specific only where the provider supplies a signature contract. GitHub HMAC verification is implemented. Gmail Pub/Sub and Google Calendar authentication are intentionally left to the configured external ingress identity boundary rather than inventing unsupported provider-native signatures.

## Exit state

- `GITHUB_WEBHOOK_ADAPTER_V1 = COMPLETE`
- `GMAIL_PUSH_ADAPTER_V1 = COMPLETE`
- `GOOGLE_CALENDAR_WEBHOOK_ADAPTER_V1 = COMPLETE`
- `PROVIDER_WEBHOOK_HTTP_ROUTER_V1 = COMPLETE`
- `SCHEDULE_OCCURRENCE_SOURCE_V1 = COMPLETE`
- `PROVIDER_DELIVERY_IDEMPOTENCY = COMPLETE`
- `EMBEDDED_SCHEDULER = NOT_IMPLEMENTED`
- `PRODUCTION_PUBSUB_IDENTITY_VERIFICATION = NOT_IMPLEMENTED`
- `CALENDAR_CHANNEL_LIFECYCLE = NOT_IMPLEMENTED`
- `DURABLE_EXECUTION_ADAPTER = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`
