# Post-MVP Media Contract Freeze v1

Status: MEDIA-02_SPEC_COMPLETE / EXECUTION_DEFERRED_BY_MVP_FREEZE

## Claim

The cross-platform NaIA media-domain contract can be frozen before platform implementation without changing the current MVP runtime.

## Hypothesis

If Android, iOS and Windows are required to implement one platform-neutral contract plus one common conformance suite, later platform work can vary internally while preserving NaIA authority, approval, idempotency and evidence semantics.

## Procedure

1. Freeze request/response semantics for all six `media.*` capabilities.
2. Freeze adapter capability-discovery metadata.
3. Freeze risk and approval scopes.
4. Freeze immutable cleanup-plan and fingerprint rules.
5. Freeze stable domain error taxonomy.
6. Define one adapter-independent conformance suite.
7. Define one canonical fixture shared by all adapters.
8. Do not add executable media code while the current MVP is frozen.

## Artifacts

- `POST-MVP-MEDIA-CONTRACT-V1.md`
- `POST-MVP-MEDIA-CONFORMANCE-V1.md`
- `media-contract-v1/conformance-fixture.json`

## Frozen contract decisions

Capabilities:

- `media.scan`
- `media.duplicates.find`
- `media.classify`
- `media.storage.report`
- `media.cleanup.plan`
- `media.cleanup.execute`

Risk classes:

- read-only capabilities and cleanup planning: `READ_ONLY`;
- recoverable cleanup: `EXTERNAL_WRITE`;
- permanent deletion: `DESTRUCTIVE_WRITE`.

Approval scopes bind to the exact cleanup plan and fingerprint:

```text
media:cleanup:trash:<planId>:<fingerprint>
media:cleanup:permanent:<planId>:<fingerprint>
```

A recoverable approval can never authorize permanent deletion.

## Conformance baseline

Common suite: `MC-01` through `MC-20`.

Additional platform vectors:

- Android: `MA-01..03`;
- iOS: `MI-01..03`;
- Windows: `MW-01..04`.

Canonical fixture properties:

- five items inside approved scope;
- total approved bytes = 3500;
- one exact duplicate pair;
- one perceptually similar non-exact candidate;
- one unknown classification case;
- one stale-identity mutation case;
- one partial-success case;
- privacy sentinels that must never appear in persisted evidence.

## Result

```text
MEDIA-02 CONTRACT SPEC              PASS
MEDIA-02 CONFORMANCE SPEC           PASS
MEDIA-02 CANONICAL FIXTURE          PASS
MEDIA-02 FAKE-ADAPTER EXECUTION     NOT_EXECUTED
```

The fake-adapter execution is intentionally `NOT_EXECUTED`, not `FAIL`: the current MVP freeze permits documentation/research but prohibits adding new end-user capability/runtime code before `MVP_CORE_READY=PASS`.

## Decision

MEDIA-02 is complete at the specification level. When the frozen MVP closes, the first executable post-MVP block is to implement a fake/in-memory adapter and run `MC-01..20` before starting Android, iOS or Windows native adapters.

The MiaClean legal gate from MEDIA-01 remains independent: it blocks copying/reusing/distributing MiaClean source but does not invalidate this clean-room NaIA contract.
