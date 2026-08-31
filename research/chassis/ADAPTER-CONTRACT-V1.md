# Chassis Adapter Contract V1

Status: SPECIFIED

Every candidate adapter must expose equivalent observable semantics. Native engine APIs may differ, but the test harness must not be rewritten to favor a candidate.

## Required commands

An adapter executable must support:

```text
start --objective-id <id> --operation-id <id> --oracle-url <url>
resume --objective-id <id> --operation-id <id> --oracle-url <url>
approve --objective-id <id>
cancel --objective-id <id>
status --objective-id <id>
```

Candidate-specific bootstrap is allowed outside these commands, e.g. starting a Temporal server or Restate server.

## Structured stdout

Adapter stdout is JSON Lines. Each line must be one object.

Required fields:

```json
{
  "event": "event_name",
  "candidate": "candidate-id",
  "objectiveId": "objective-id",
  "attempt": 1,
  "timestamp": "RFC3339"
}
```

Optional fields may include workflow/run IDs, native task tokens, checkpoint IDs and evidence.

## Required observable events

```text
adapter_ready
objective_persisted
internal_step_started
internal_step_completed
internal_step_checkpointed
timer_wait_started
timer_resumed
approval_wait_started
approval_received
external_request_starting
external_request_applied_or_ambiguous
external_result_persisted
verification_started
objective_completed
objective_cancelled
reconciliation_required
stale_completion_rejected
fatal_error
```

The harness may kill the adapter immediately after any emitted event.

An adapter must not emit an event before the underlying semantic point has occurred merely to make testing convenient.

## Status response

`status` must return machine-readable JSON containing at least:

```json
{
  "objectiveId": "...",
  "state": "PENDING|RUNNING|WAITING_APPROVAL|WAITING_TIMER|RECONCILIATION_REQUIRED|CANCELLED|COMPLETED|FAILED",
  "attempt": 1,
  "currentAuthority": "...",
  "operationId": "...",
  "externalState": "NOT_STARTED|UNKNOWN|APPLIED|RECONCILED",
  "evidenceComplete": false
}
```

## Fail-closed requirements

Adapter must reject or stop when:

- objective identity is absent;
- external operation identity is absent for effectful work;
- recovered workflow identity resolves to incompatible code/config without an explicit versioning strategy;
- required durability backend is unavailable and the candidate cannot safely continue;
- an external effect is ambiguous and no reconciliation policy exists.

## Prohibited benchmark adaptations

Adapters may not:

- bypass the candidate's durable engine for hard mutants;
- add a custom database transaction unavailable to other candidates solely to win a test;
- turn a process kill mutant into a caught exception;
- replace the common external oracle with a candidate-native mock;
- mark ambiguous external effects successful without consulting the oracle/provider state.

## Evidence identity

Every run must record:

- candidate version;
- candidate source commit when available;
- SDK/runtime version;
- deployment profile;
- adapter source SHA;
- test-suite version;
- objective ID;
- external operation ID;
- mutant ID;
- repetition number.
