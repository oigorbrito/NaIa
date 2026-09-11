# NaIA External Scheduler V1

Status: IMPLEMENTED_PENDING_LOCAL_REPRO

## Purpose

Move schedule delivery across an operating-system process boundary while preserving the existing NaIA trigger, idempotency, confirmation, evidence, and persistence semantics.

The scheduler is not allowed to bypass NaIA policy. It only emits a signed `schedule.occurrence` delivery into the existing trigger runtime.

## Process contract

External schedulers invoke:

```text
npm run schedule:deliver -- <occurrenceId> [at]
```

Required runtime configuration:

```text
NAIA_DATA_DIR
NAIA_SCHEDULE_SECRET
NAIA_SCHEDULE_AUTOMATION_ID
NAIA_SCHEDULE_EXPRESSION
NAIA_SCHEDULE_TIMEZONE
NAIA_SCHEDULE_INTENT
```

`NAIA_SCHEDULE_SECRET` is construction/runtime state only and is not persisted.

## Invariants

- delivery enters through the existing HMAC-authenticated trigger runtime;
- idempotency key remains `<automationId>:<occurrenceId>`;
- replay from a different process must reuse the same objective;
- scheduled objectives remain `WAITING_CONFIRMATION` until explicitly confirmed;
- restart/process exit does not lose the objective or plan;
- scheduler secret must not appear in objectives, plans, or evidence;
- incomplete scheduler configuration fails before side effects.

## Windows Task Scheduler integration

`ops/windows/register-naia-schedule.ps1` registers a daily Windows Scheduled Task. The task definition contains no NaIA secret. It invokes `ops/windows/invoke-naia-schedule.ps1`, which reads the scheduled account environment and derives a deterministic occurrence id from automation id plus UTC minute.

Example registration:

```powershell
.\ops\windows\register-naia-schedule.ps1 `
  -TaskName 'NaIA-Daily-Brief' `
  -WorkingDirectory 'C:\Projetos\naia' `
  -DailyAt '08:00'
```

The scheduled account must have the required `NAIA_SCHEDULE_*` variables available.

## Gates

- EXT-SCHED-01 separate process persists scheduled objective.
- EXT-SCHED-02 replay from another process deduplicates occurrence.
- EXT-SCHED-03 scheduler secret is absent from persisted state.
- EXT-SCHED-04 incomplete configuration fails before side effects.
- EXT-SCHED-05 later independent process confirms and completes same objective.

## Reproduction

Expected aggregate suite:

```text
55 prior product tests
+ 5 external scheduler tests
= 60 tests
```

Acceptance target: `tests 60 / pass 60 / fail 0`.

A real Windows Task Scheduler registration/run remains an operational E2E step and must be recorded separately from the deterministic child-process contract suite.
