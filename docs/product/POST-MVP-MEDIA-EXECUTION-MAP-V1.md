# Post-MVP Media Execution Map v1

Status: PLANNED_POST_MVP / EXECUTOR_READY

This document turns `POST-MVP-MOBILE-MEDIA-V1.md` into an execution sequence for an implementation agent. It does not modify the frozen MVP readiness contract.

## Non-negotiable product rules

1. NaIA remains the authority/planning layer.
2. Android, iOS and Windows MUST expose the same NaIA-facing `media.*` contract.
3. Platform adapters provide competence only; platform APIs MUST NOT leak into NaIA core vocabulary.
4. Read-only media operations are separate from mutating operations.
5. Any mutation requires explicit NaIA approval and any OS-native consent/authorization required by the platform.
6. Approval is scoped to the exact cleanup plan/media set/action and is not transferable.
7. Raw photos/videos MUST NOT be persisted in NaIA evidence by default.
8. Recoverable cleanup and permanent deletion MUST be distinct outcomes where the platform supports that distinction.
9. Replay/idempotency MUST prevent duplicate destructive execution.
10. No platform is considered complete until its adapter passes the common conformance suite plus a real-device/runtime E2E.

## Canonical contract

Capabilities:

- `media.scan`
- `media.duplicates.find`
- `media.classify`
- `media.storage.report`
- `media.cleanup.plan`
- `media.cleanup.execute`

Every platform adapter must additionally expose capability metadata describing:

- supported media sources;
- supported cleanup modes;
- whether native confirmation is required;
- whether cleanup is recoverable;
- platform/runtime version information.

## Canonical execution lifecycle

```text
user intent
  -> objective
  -> media capability plan
  -> platform capability discovery
  -> read-only execution OR approval gate
  -> platform-native authorization/confirmation when required
  -> platform adapter execution
  -> minimized evidence
  -> persisted outcome
```

## Common request/response invariants

### `media.scan`

Input must identify an approved/user-visible source scope, never an arbitrary hidden filesystem scope.

Output must include aggregate counts and bytes plus stable item references usable only within the adapter/runtime context.

### `media.duplicates.find`

Output must group candidate duplicates and identify the comparison basis (exact hash, perceptual similarity or other documented method).

The adapter must not claim perceptual duplicates as exact duplicates.

### `media.classify`

Output must include category, confidence/provenance where available, and failure/unknown states.

### `media.storage.report`

Output must distinguish total scanned bytes from reclaimable bytes. Reclaimable size is an estimate until a concrete cleanup plan is frozen.

### `media.cleanup.plan`

The plan must contain:

- stable `planId`;
- exact media-set references;
- proposed cleanup mode;
- item count;
- estimated reclaimable bytes;
- recoverability semantics;
- adapter/platform identity;
- immutable plan fingerprint.

Any material change requires a new plan/fingerprint and therefore a new approval.

### `media.cleanup.execute`

Execution requires the previously approved `planId` + fingerprint. The adapter must reject stale, altered or unsupported plans.

Output must distinguish:

- requested items;
- successfully affected items;
- skipped/unsupported items;
- failures;
- bytes actually reclaimed when measurable;
- whether OS confirmation was required/observed;
- recoverable vs permanent outcome.

## Risk model

- `media.scan` = `READ_ONLY`
- `media.duplicates.find` = `READ_ONLY`
- `media.classify` = `READ_ONLY`
- `media.storage.report` = `READ_ONLY`
- `media.cleanup.plan` = `READ_ONLY`
- recoverable `media.cleanup.execute` = `EXTERNAL_WRITE` / explicit approval
- permanent `media.cleanup.execute` = `DESTRUCTIVE_WRITE` / stronger explicit approval

No cleanup mode may silently downgrade from recoverable to permanent.

## Platform adapter targets

### Android

Reference implementation: reusable/refactored portions of `gmailum/MiaClean`.

Expected native concerns:

- MediaStore;
- SAF-selected sources;
- exact/perceptual hashing;
- media classification;
- MediaStore trash/delete requests;
- Android system consent.

Do not import MiaClean billing, standalone UI/navigation, onboarding or product identity into NaIA core.

### iOS

Implement the same contract with Apple-native media/file access and user authorization semantics.

The adapter must explicitly report limitations where iOS does not expose an Android-equivalent operation. Unsupported behavior is a first-class result, not an emulated unsafe workaround.

### Windows

Implement the same contract using user-visible filesystem/library selection and Windows-native file/recycle-bin behavior.

Requirements:

- user-scoped source roots;
- no silent traversal outside approved roots;
- recycle-bin/recoverable cleanup preferred where available;
- permanent deletion represented by a distinct cleanup mode and approval scope;
- filesystem races handled by revalidating item identity before mutation.

## Execution waves

### MEDIA-01 — source/legal baseline

Exit only when:

- exact MiaClean revision is pinned;
- ownership/license/redistribution decision is recorded;
- reusable engine components are inventoried;
- no code is copied before legal/source status is explicit.

### MEDIA-02 — contract freeze

Produce:

- versioned schemas for all six capabilities;
- adapter capability-discovery schema;
- risk/approval table;
- cleanup plan/fingerprint rules;
- common error taxonomy;
- common conformance fixtures.

Exit criterion: a fake adapter can pass the complete contract suite without platform-specific code.

### MEDIA-03 — Android read-only

Implement scan, duplicate discovery, classification, storage report and cleanup planning.

Exit criterion: NaIA -> Android adapter -> result E2E on a real Android device with no destructive operation.

### MEDIA-04 — iOS read-only

Implement the same read-only contract.

Exit criterion: same conformance vectors + real iOS device E2E.

### MEDIA-05 — Windows read-only

Implement the same read-only contract for explicitly selected libraries/folders.

Exit criterion: same conformance vectors + real Windows machine E2E.

### MEDIA-06 — Android cleanup

Implement recoverable cleanup first; permanent deletion only as a separate supported mode.

Exit criterion: no mutation before NaIA approval; OS confirmation preserved; replay cannot duplicate deletion; minimized evidence verified.

### MEDIA-07 — iOS cleanup

Implement only cleanup modes the platform can safely and explicitly support.

Exit criterion: same authority/idempotency/evidence properties as Android, with documented platform differences.

### MEDIA-08 — Windows cleanup

Implement recycle-bin flow before permanent delete.

Exit criterion: approved-plan fingerprint enforced; file identity revalidated immediately before mutation; recoverable/permanent paths have separate approval scopes.

### MEDIA-09 — cross-platform conformance

Run one shared suite against Android, iOS and Windows adapters.

Required result categories:

- `PASS`
- `FAIL`
- `NOT_EXECUTED`
- `BLOCKED_EXTERNAL`

No platform-wide PASS may be inferred from another platform.

### MEDIA-10 — production-readiness evidence

Required artifacts:

- Android real-device receipt;
- iOS real-device receipt;
- Windows real-machine receipt;
- common conformance receipt for all three adapters;
- destructive-action approval/idempotency receipt;
- evidence-minimization receipt;
- license/source decision artifact.

Only then may the media capability be promoted from `PLANNED_POST_MVP` to production-ready.

## Common error taxonomy

Adapters should map native failures into stable NaIA-level categories:

- `PERMISSION_REQUIRED`
- `SOURCE_UNAVAILABLE`
- `UNSUPPORTED_OPERATION`
- `STALE_MEDIA_REFERENCE`
- `STALE_CLEANUP_PLAN`
- `NATIVE_CONFIRMATION_REQUIRED`
- `NATIVE_CONFIRMATION_DENIED`
- `PARTIAL_SUCCESS`
- `TRANSIENT_IO_FAILURE`
- `PERMANENT_IO_FAILURE`

Native exception/error text may be retained only in minimized diagnostic metadata when safe; it must not become the domain contract.

## Evidence policy

Persist by default:

- operation id;
- platform/adapter version;
- aggregate counts;
- aggregate bytes;
- category/duplicate group summaries;
- cleanup plan id/fingerprint;
- approval scope;
- outcome counts;
- error category;
- timestamps.

Do not persist by default:

- raw media bytes;
- thumbnails;
- full photo/video metadata dumps;
- arbitrary filesystem paths when a stable opaque reference is sufficient;
- tokens/authorization artifacts;
- OS consent handles.

## Executor decision rule

For every block, use:

`claim -> hypothesis -> procedure -> execution -> artifact -> result -> decision`

A block is complete only when its exit artifact exists and the result is classified. External device/account unavailability is `BLOCKED_EXTERNAL`; it does not invalidate locally executable contract work and must not stop unrelated blocks in the same wave.

## Relationship to frozen MVP

This execution map is documentation/research only until `MVP_CORE_READY=PASS`. It MUST NOT change `src/product/readiness-manifest.mjs`, the expected MVP test count, or the current historical readiness gates.
