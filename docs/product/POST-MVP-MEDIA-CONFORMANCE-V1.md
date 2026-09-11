# Post-MVP Device Media Conformance v1

Status: MEDIA-02_CONFORMANCE_FROZEN

This suite defines adapter-independent acceptance vectors for Android, iOS and Windows implementations of `POST-MVP-MEDIA-CONTRACT-V1.md`.

## Result vocabulary

Each vector produces exactly one of:

- `PASS`
- `FAIL`
- `NOT_EXECUTED`
- `BLOCKED_EXTERNAL`

A platform is conformant only from observed `PASS` evidence for every mandatory vector supported by its declared capability metadata. Declared unsupported optional modes must return `UNSUPPORTED_OPERATION`; they are not inferred as PASS.

## Mandatory contract vectors

### MC-01 — discovery/version

Adapter reports `contractVersion=1`, stable adapter identity, platform identity and capability metadata.

PASS when all required fields exist and unsupported future versions fail closed.

### MC-02 — source scope isolation

Provide one approved source plus one path/resource outside it.

PASS when scan returns only items from the approved source and does not silently traverse outside it.

### MC-03 — opaque references

PASS when NaIA-facing results use `sourceRef`/`itemRef` and do not require the core to parse a native path/URI.

### MC-04 — scan aggregation

Fixture contains known item count and total bytes.

PASS when `media.scan.summary` exactly matches the fixture.

### MC-05 — exact duplicate distinction

Fixture contains two byte-identical items and one perceptually similar but non-identical item.

PASS when exact pair is `EXACT_HASH` and the similar item is not reported as exact.

### MC-06 — perceptual/semantic provenance

PASS when non-exact grouping reports its actual comparison basis and never upgrades similarity to exact identity.

### MC-07 — classification unknown

Provide an item that cannot be confidently classified.

PASS when the adapter returns `UNKNOWN`/documented low-confidence state rather than inventing certainty.

### MC-08 — storage estimate semantics

PASS when `scannedBytes` and `estimatedReclaimableBytes` are separate and reclaimable bytes are labeled as estimate before a cleanup plan exists.

### MC-09 — immutable plan

Create a cleanup plan, then materially change item set or cleanup mode.

PASS when a new `planId` and fingerprint are required.

### MC-10 — deterministic plan fingerprint

Create the same canonical plan material twice.

PASS when fingerprint is identical; changing any covered material changes the fingerprint.

### MC-11 — approval required

Attempt `media.cleanup.execute` without NaIA approval.

PASS when there is no mutation and result/error is `APPROVAL_REQUIRED` or equivalent authority-layer denial.

### MC-12 — approval scope mismatch

Approve plan A and dispatch plan B, or approve TRASH and request DELETE_PERMANENT.

PASS when execution is rejected before mutation.

### MC-13 — stale plan rejection

Modify/recreate underlying plan material after approval.

PASS when execute rejects with `STALE_CLEANUP_PLAN` before mutation.

### MC-14 — stale media identity rejection

Replace/change an underlying file/media object while retaining the old `itemRef` where the platform permits this race.

PASS when identity revalidation prevents mutation and surfaces `STALE_MEDIA_REFERENCE`.

### MC-15 — idempotent destructive replay

Execute an approved cleanup using one `idempotencyKey`, then replay the identical request.

PASS when the underlying mutation happens at most once and the replay returns/reconstructs the original outcome.

### MC-16 — native confirmation preservation

For an operation requiring OS confirmation, deny the native confirmation.

PASS when no mutation is reported and `NATIVE_CONFIRMATION_DENIED` (or a documented equivalent mapped code) is surfaced.

### MC-17 — no recoverable-to-permanent downgrade

Request `TRASH` on a platform/source where only permanent delete is possible.

PASS when adapter returns `UNSUPPORTED_OPERATION` (or equivalent capability result) rather than permanently deleting.

### MC-18 — partial success accounting

Use a plan containing one successful item and one item that must fail/skip.

PASS when counts and per-item outcomes reconcile exactly and the result is `PARTIAL_SUCCESS` where applicable.

### MC-19 — evidence minimization

Execute representative scan/plan/cleanup flow using fixtures containing sensitive filenames/metadata.

PASS when persisted NaIA evidence contains allowed aggregates/ids only and omits raw media, thumbnails, authorization artifacts, biometric vectors and unnecessary native paths.

### MC-20 — capability mismatch

Invoke a capability/mode the adapter explicitly declares unsupported.

PASS when it fails closed as `UNSUPPORTED_OPERATION` without fallback side effects.

## Platform-specific mandatory vectors

### Android

- MA-01 MediaStore/SAF source authorization preserved.
- MA-02 system trash/delete confirmation preserved when required.
- MA-03 replay cannot duplicate MediaStore/SAF mutation.

### iOS

- MI-01 user media authorization scope preserved.
- MI-02 unsupported cleanup semantics reported explicitly rather than emulated unsafely.
- MI-03 platform-native confirmation/authorization preserved where required.

### Windows

- MW-01 traversal never escapes approved roots.
- MW-02 recycle-bin/recoverable operation remains distinct from permanent delete.
- MW-03 filesystem identity is revalidated immediately before mutation.
- MW-04 permanent-delete approval cannot be satisfied by recycle-bin approval.

## Fake adapter gate

MEDIA-02 exits only after a fake/in-memory adapter can model all common request/response shapes and all common vectors MC-01..MC-20 without using Android, iOS or Windows APIs.

Because the current MVP branch is frozen, MEDIA-02 records this as a contract artifact now; executable fake-adapter code belongs to the post-MVP implementation branch after `MVP_CORE_READY=PASS`.

## Real platform gate

No platform is production-ready from contract tests alone. Later waves require:

- Android: common conformance + Android vectors + real-device E2E receipt.
- iOS: common conformance + iOS vectors + real-device E2E receipt.
- Windows: common conformance + Windows vectors + real-machine E2E receipt.

## Receipt minimum

A conformance receipt must identify:

```json
{
  "contractVersion":1,
  "adapterId":"...",
  "adapterVersion":"...",
  "platform":"android|ios|windows|fake",
  "platformVersion":"...",
  "commit":"...",
  "vectors":{"MC-01":"PASS"},
  "summary":{"pass":0,"fail":0,"notExecuted":0,"blockedExternal":0},
  "observedAt":"ISO-8601"
}
```

Receipts are commit-bound and must not be reused across materially different adapter revisions.
