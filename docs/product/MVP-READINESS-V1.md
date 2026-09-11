# NaIA MVP Readiness V1

Status: IMPLEMENTED_PENDING_EXECUTION

## Purpose

Collapse MVP closure into one evidence-driven status instead of manually interpreting several independent runs.

The historical MVP core readiness definition remains:

1. full local product suite passes;
2. two independent clean-checkout reproductions pass on the exact same commit;
3. an external scheduler delivers a real occurrence across the process boundary;
4. a real provider event reaches NaIA through the provider ingress.

Google Calendar live read is reported separately as a secretary-capability gate. It does not retroactively redefine the historical core MVP gate.

## Consolidated command

On Windows:

```powershell
npm run mvp:readiness
```

or directly:

```powershell
.\ops\mvp-readiness.ps1
```

The runner writes:

```text
.reproduction/mvp-readiness.json
```

and exits with code 0 only when `mvpCoreReady=PASS`.

## Local suite + clean reproductions

Run the local suite and create both clean receipts:

```powershell
.\ops\mvp-readiness.ps1 -RunClean
```

Expected clean receipts:

```text
.reproduction/run-01.json
.reproduction/run-02.json
```

Each clean receipt must identify the exact current commit and contain:

```text
status=PASS
cleanClone=true
npmCi=PASS
npmTest=PASS
diffCheck=PASS
```

## External scheduler receipt

The Windows Task Scheduler wrapper now defaults the delivery receipt to:

```text
.reproduction/external-scheduler.json
```

A real scheduled invocation must produce:

```text
status=PASS
gate=EXTERNAL_SCHEDULER_DELIVERY
```

The secret remains runtime-only and is not included in the receipt.

## Live provider event receipt

Before starting the GitHub webhook server, set:

```powershell
$env:NAIA_GITHUB_WEBHOOK_RECEIPT = '.reproduction\provider-event.json'
```

A real accepted GitHub webhook writes:

```text
status=PASS
gate=LIVE_PROVIDER_EVENT
```

Receipt persistence is telemetry only: failure to write the receipt does not turn an already accepted webhook into an HTTP failure or cause unnecessary provider retry.

## Google Calendar live capability receipt

With a valid OAuth access token:

```powershell
$env:NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN = '<oauth access token>'
.\ops\mvp-readiness.ps1 -RunLiveGoogle
```

The live harness writes:

```text
.reproduction/google-calendar-live.json
```

with:

```text
status=PASS
gate=LIVE_GCAL_READ
```

The access token is never written to the receipt or NaIA persistence.

## Status fields

`mvp-readiness.json` contains:

```text
commit
expectedProductTests
observedProductTests
localSuite
cleanReproduction1
cleanReproduction2
externalScheduler
liveProviderEvent
liveGoogleCalendarRead
mvpCoreReady
generatedAt
```

Current expected product test count on this branch is 67.

## Interpretation

`mvpCoreReady=PASS` is only emitted when every historical core gate has observed PASS evidence for the current checkout/reproduction state.

Missing external receipts remain `NOT_EXECUTED`; missing Google credentials remain `BLOCKED_EXTERNAL_OR_NOT_EXECUTED`. No missing gate is silently upgraded to PASS.
