# NaIA Google Calendar Live E2E V1

Status: IMPLEMENTED_PENDING_EXTERNAL_CREDENTIAL

## Purpose

Exercise the full NaIA product stack against a real Google Calendar account without creating or modifying calendar events.

Flow:

```text
intent
-> capability planner
-> NaIA service/policy
-> Google Calendar execution adapter
-> Google Calendar API
-> evidence/persistence
```

The harness is intentionally read-only. It proves live provider authentication, request/response compatibility, NaIA execution routing, evidence generation, and credential non-persistence without leaving a side effect in the user's calendar.

## Required credential

```text
NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN
```

Optional:

```text
NAIA_GOOGLE_CALENDAR_ID                 default primary
NAIA_GOOGLE_CALENDAR_LIVE_FROM          default now
NAIA_GOOGLE_CALENDAR_LIVE_TO            default now + 24h
NAIA_GOOGLE_CALENDAR_LIVE_KEEP=1        keep temporary NaIA data for inspection
```

## Run

```powershell
$env:NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN = '<oauth access token>'
npm run live:google-calendar
```

Expected result:

```json
{
  "status": "PASS",
  "gate": "LIVE_GCAL_READ"
}
```

## Acceptance

PASS requires all of the following:

- Google Calendar returns successfully using the supplied token;
- NaIA objective reaches `COMPLETED`;
- successful `calendar.list` execution evidence exists;
- access token is absent from objectives, plans, and evidence persisted by the harness;
- harness performs no create/update/delete operation.

## Deterministic harness test

`LIVE-GCAL-01` runs the same harness against a local HTTP fixture and verifies request routing plus token non-disclosure. This test is part of `npm test`.

Aggregate expected suite on this branch:

```text
60 prior product tests
+ 1 live-harness contract
= 61 tests
```

A real Google account run cannot be declared PASS until executed with a valid user-owned OAuth access token. Until then `LIVE_GCAL_READ = BLOCKED_EXTERNAL` while the harness implementation itself is testable.
