# Chassis Crash Controller Baseline — 2026-08-31

Status: LOCAL PASS

## Purpose

Validate that the neutral NaIa harness can terminate an adapter process at an observable semantic killpoint without converting the fault into a catchable application exception.

This is harness evidence only. It is not a result for any candidate chassis.

## Environment

- Node: 22.16.0
- npm: 10.9.2
- Process fault: `SIGKILL`
- Test runner: Node built-in `node:test`

## Source identity

Local executed Git blob SHAs matched the branch:

| File | Git blob SHA |
|---|---|
| `research/chassis/harness/crash-controller.mjs` | `42f5987e1beeabd81c32ef60931b7db1ef42c708` |
| `research/chassis/harness/crash-controller.test.mjs` | `847b666767822793759dd7c13bfa880c24e3f241` |
| `research/chassis/harness/fixtures/fake-adapter.mjs` | `23940dcceb99319c109b5afaf4e28647878a9798` |

## Combined local harness result

After adding the crash controller, the complete neutral harness produced:

```text
tests = 8
pass = 8
fail = 0
cancelled = 0
skipped = 0
todo = 0
```

Controller-specific tests:

1. adapter emits `external_request_applied_or_ambiguous`; controller observes the semantic event and sends `SIGKILL`;
2. requested semantic event never occurs; controller times out and kills the process rather than pretending the mutation succeeded.

## Interpretation

`PROCESS_KILL_IS_EXTERNAL_TO_ADAPTER = PASS`

`SEMANTIC_KILLPOINT_OBSERVED_BEFORE_KILL = PASS`

`MISSING_KILLPOINT_FAILS_CLOSED = PASS`

`CANDIDATE_RECOVERY = NOT_TESTED`

The controller is now suitable as a building block for process-level T1–T4, T7–T12 and T16 tests once real candidate adapters are available.
