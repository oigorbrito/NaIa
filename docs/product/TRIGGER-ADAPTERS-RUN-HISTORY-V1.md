# NaIA Trigger Adapters and Automation Run History V1

Status: COMPLETE

This wave adds a chassis-independent trigger ingress runtime around reusable automations.

## Delivered

- trigger adapter registry with MANUAL, SCHEDULE, and EVENT adapters
- normalized trigger deliveries
- explicit schedule occurrence identity (`scheduledFor`)
- explicit event delivery identity (`eventId`)
- deterministic idempotency keys with caller override
- deduplication before automation proposal creation
- persisted automation run history in `.naia/automation-runs.json`
- run statuses linked to objective lifecycle
- rejected delivery history
- CLI `automation:deliver` and `automation:history`
- focused tests for adapter normalization, deduplication, rejection, and stable derived keys

## Runtime boundary

Trigger adapters do not execute workflow actions directly. A valid, non-duplicate delivery calls the reusable automation entry point and produces a fresh objective in `WAITING_CONFIRMATION`. Confirmation, provider connection checks, and scoped write approval remain unchanged.

The trigger runtime is intentionally outside NaIA Core execution semantics. External schedulers, webhook listeners, event buses, and a future durable chassis can deliver normalized events through this boundary without changing workflow or policy logic.

## Idempotency

A delivery may provide an explicit `idempotencyKey`. Otherwise NaIA derives a SHA-256 key from canonicalized automation id, trigger payload, and parameters. Duplicate deliveries return the existing run instead of creating a second objective.

## Run history

Each accepted delivery stores:

- run id
- automation id
- idempotency key
- trigger payload
- parameters
- source
- objective id
- lifecycle status
- timestamps

History reconciles with the current objective status when read, so confirmation, approval, completion, failure, or connection waiting state is reflected without duplicating objective state inside the trigger runtime.

## Non-claims

- no embedded scheduler
- no webhook HTTP server
- no event-bus consumer
- no parallel trigger worker
- no durable execution chassis selected
- no chassis winner selected
