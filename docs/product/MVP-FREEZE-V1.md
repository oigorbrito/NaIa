# NaIA MVP Freeze V1

Status: FROZEN_PENDING_EVIDENCE

## Purpose

Freeze the current MVP implementation surface while the remaining readiness gates are executed. No new product capability should be added to the MVP branch until the evidence gates below are closed or the freeze is explicitly superseded by a versioned decision.

## Frozen readiness contract

The authoritative readiness contract is `src/product/readiness-manifest.mjs` (schema version 1).

Core gates:

1. `LOCAL_PRODUCT_SUITE`
2. `CLEAN_REPRODUCTION_1`
3. `CLEAN_REPRODUCTION_2`
4. `EXTERNAL_SCHEDULER_DELIVERY`
5. `LIVE_PROVIDER_EVENT`

Optional secretary-capability gate:

- `LIVE_GCAL_READ`

The current expected product test count is 78.

## Change policy during freeze

Allowed before readiness closes:

- fixes for an observed failure in an existing MVP gate;
- harness/readiness corrections needed to prevent false PASS or false FAIL;
- security fixes for the existing MVP surface;
- documentation corrections that do not redefine readiness.

Not allowed without an explicit versioned scope change:

- new provider families;
- new end-user capabilities;
- new framework/chassis adoption;
- changes that redefine the historical core readiness gates;
- lowering an acceptance criterion to make a failing gate pass.

## Evidence rule

Claims use the project vocabulary:

- `PASS`
- `FAIL`
- `NOT_EXECUTED`
- `BLOCKED_EXTERNAL`

A gate is `PASS` only from observed evidence. Live receipts are commit-bound; stale receipts cannot satisfy the current checkout.

## Local evidence hygiene

Runtime state and evidence directories are intentionally untracked:

```text
.naia/
.reproduction/
```

Secrets remain runtime-only or DPAPI-protected for the current Windows user. Reproduction receipts must not contain scheduler/webhook secrets or Google OAuth tokens.

## Remaining closure sequence

On the frozen branch:

```powershell
cd C:\Projetos\naia
git fetch origin
git checkout product/mvp-readiness-v1
git pull origin product/mvp-readiness-v1

.\ops\mvp-readiness.ps1 -RunClean
```

Then close the real external scheduler gate:

```powershell
.\ops\mvp-readiness.ps1 `
  -RunSchedulerTask `
  -SchedulerTaskName 'NaIA-MVP-Schedule'
```

Then run the persisted GitHub webhook ingress, expose it through a user-controlled HTTPS endpoint, deliver one real configured GitHub event, and rerun:

```powershell
npm run mvp:readiness
```

`MVP_CORE_READY=PASS` may be declared only when the consolidated receipt reports every core gate as `PASS` for the same current commit.

## Framework status

OpenManus remains an accepted experimental candidate for the minimal execution/reverse-authority contracts, but it is not required by the frozen MVP. Chassis adoption remains a post-MVP or explicitly re-scoped decision.
