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

All live receipts are commit-bound. A PASS receipt produced by another checkout is classified as `STALE_RECEIPT` and cannot satisfy readiness.

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

Native process success is determined by exit code. Git/npm progress written to stderr is not treated as a PowerShell failure.

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

Current expected product test count is 67.

## External scheduler: durable Windows configuration

Do not rely on environment variables defined only in an interactive shell. Configure the scheduler once with non-secret settings plus a DPAPI-protected secret:

```powershell
.\ops\windows\configure-naia-schedule.ps1 `
  -WorkingDirectory 'C:\Projetos\naia' `
  -AutomationId 'mvp-schedule' `
  -ScheduleExpression 'daily' `
  -Intent 'uppercase: external scheduler'
```

The HMAC secret is requested as a `SecureString` and stored through Windows DPAPI for the current user under `.naia\ops`. It is not stored in the Scheduled Task definition or readiness receipt.

Register the real task:

```powershell
.\ops\windows\register-naia-schedule.ps1 `
  -TaskName 'NaIA-MVP-Schedule' `
  -WorkingDirectory 'C:\Projetos\naia' `
  -DailyAt '09:00'
```

Exercise the actual Task Scheduler boundary immediately:

```powershell
.\ops\windows\verify-naia-schedule.ps1 `
  -TaskName 'NaIA-MVP-Schedule' `
  -WorkingDirectory 'C:\Projetos\naia'
```

or let the consolidated runner invoke it:

```powershell
.\ops\mvp-readiness.ps1 -RunSchedulerTask -SchedulerTaskName 'NaIA-MVP-Schedule'
```

A valid invocation produces:

```text
.reproduction/external-scheduler.json
status=PASS
gate=EXTERNAL_SCHEDULER_DELIVERY
commit=<current HEAD>
```

## Live provider event: durable Windows configuration

Configure the GitHub webhook ingress and its HMAC secret:

```powershell
.\ops\windows\configure-naia-github-webhook.ps1 `
  -WorkingDirectory 'C:\Projetos\naia' `
  -AutomationId 'mvp-provider-event' `
  -EventType 'push' `
  -Intent 'uppercase: provider event'
```

The webhook secret is protected with Windows DPAPI for the current user. Start the ingress from the persisted configuration:

```powershell
.\ops\windows\invoke-naia-github-webhook.ps1 `
  -WorkingDirectory 'C:\Projetos\naia'
```

The configured listen address must be exposed through a user-controlled/publicly reachable HTTPS endpoint before GitHub can deliver the real webhook. A real accepted GitHub delivery writes:

```text
.reproduction/provider-event.json
status=PASS
gate=LIVE_PROVIDER_EVENT
commit=<current HEAD>
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
status=PASS
gate=LIVE_GCAL_READ
commit=<current HEAD>
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

## Interpretation

`mvpCoreReady=PASS` is only emitted when every historical core gate has observed PASS evidence for the current checkout.

Missing external receipts remain `NOT_EXECUTED`; a valid receipt for another commit becomes `STALE_RECEIPT`; missing Google credentials remain `BLOCKED_EXTERNAL_OR_NOT_EXECUTED`. No missing or stale gate is silently upgraded to PASS.
