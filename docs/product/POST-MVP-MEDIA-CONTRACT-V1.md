# Post-MVP Device Media Contract v1

Status: MEDIA-02_CONTRACT_FROZEN

This document freezes the NaIA-facing contract for device media management on Android, iOS and Windows. It is post-MVP documentation only and does not alter the frozen MVP readiness manifest or test count.

## Contract version

`media-contract-version = 1`

All adapters MUST implement the same domain vocabulary. Platform-native APIs and exception types remain behind the adapter boundary.

## Capability discovery

Every adapter MUST expose metadata equivalent to:

```json
{
  "contractVersion": 1,
  "adapterId": "string",
  "adapterVersion": "string",
  "platform": "android|ios|windows",
  "platformVersion": "string",
  "capabilities": {
    "media.scan": true,
    "media.duplicates.find": true,
    "media.classify": true,
    "media.storage.report": true,
    "media.cleanup.plan": true,
    "media.cleanup.execute": true
  },
  "supportedSources": ["opaque-source-kind"],
  "supportedCleanupModes": ["TRASH", "DELETE_PERMANENT"],
  "nativeConfirmation": {
    "TRASH": "NEVER|MAY|ALWAYS",
    "DELETE_PERMANENT": "NEVER|MAY|ALWAYS"
  }
}
```

Unsupported capability/mode MUST be returned explicitly as `UNSUPPORTED_OPERATION`; adapters must not silently emulate a stronger/destructive mode.

## Common identifiers

- `operationId`: unique id for one capability invocation.
- `sourceRef`: opaque adapter-scoped source reference.
- `itemRef`: opaque adapter-scoped media reference. MUST NOT require a raw filesystem path in NaIA core.
- `groupId`: duplicate-group identifier scoped to a scan/result set.
- `planId`: immutable cleanup-plan identifier.
- `planFingerprint`: deterministic fingerprint over the immutable cleanup-plan material.
- `idempotencyKey`: caller-supplied key used to prevent duplicate mutating execution.

Opaque references may embed platform details internally but NaIA core MUST treat them as uninterpreted strings.

## `media.scan`

Risk: `READ_ONLY`.

Request:

```json
{
  "operationId": "op-...",
  "sources": [{"sourceRef":"src-..."}],
  "mediaTypes": ["IMAGE","VIDEO"],
  "options": {
    "includeHidden": false
  }
}
```

Rules:

1. Every source must be user-visible/approved by platform policy.
2. Scan must not silently traverse outside approved sources.
3. `includeHidden=true` may be rejected by platforms that cannot safely support it.

Response:

```json
{
  "operationId":"op-...",
  "scanId":"scan-...",
  "items":[{
    "itemRef":"item-...",
    "mediaType":"IMAGE|VIDEO|OTHER",
    "mimeType":"string|null",
    "sizeBytes":123,
    "capturedAt":"ISO-8601|null",
    "category":"SCREENSHOT|SELFIE|MEME|DOCUMENT|PHOTO|VIDEO|OTHER|UNKNOWN"
  }],
  "summary":{"itemCount":1,"totalBytes":123}
}
```

Raw media bytes are not part of this contract.

## `media.duplicates.find`

Risk: `READ_ONLY`.

Request:

```json
{
  "operationId":"op-...",
  "scanId":"scan-...",
  "methods":["EXACT_HASH","PERCEPTUAL_HASH","SEMANTIC"]
}
```

Response:

```json
{
  "operationId":"op-...",
  "groups":[{
    "groupId":"grp-...",
    "basis":"EXACT_HASH|PERCEPTUAL_HASH|SEMANTIC",
    "items":[{"itemRef":"item-...","rank":1}],
    "estimatedDuplicateBytes":123
  }]
}
```

`EXACT_HASH` and perceptual/semantic similarity MUST never be conflated.

## `media.classify`

Risk: `READ_ONLY`.

Request:

```json
{
  "operationId":"op-...",
  "itemRefs":["item-..."]
}
```

Response item:

```json
{
  "itemRef":"item-...",
  "category":"SCREENSHOT|SELFIE|MEME|DOCUMENT|PHOTO|VIDEO|OTHER|UNKNOWN",
  "confidence":0.0,
  "provenance":"METADATA|HEURISTIC|MODEL|UNKNOWN"
}
```

Adapters must preserve `UNKNOWN` rather than invent certainty.

## `media.storage.report`

Risk: `READ_ONLY`.

Request references `scanId` and optionally duplicate result ids.

Response MUST distinguish:

```json
{
  "scannedBytes":1000,
  "estimatedReclaimableBytes":400,
  "estimateBasis":"DUPLICATE_SELECTION|CATEGORY_POLICY|OTHER"
}
```

`estimatedReclaimableBytes` is non-authoritative until a cleanup plan is frozen.

## `media.cleanup.plan`

Risk: `READ_ONLY`.

Request:

```json
{
  "operationId":"op-...",
  "itemRefs":["item-a","item-b"],
  "cleanupMode":"TRASH|DELETE_PERMANENT",
  "reason":"DUPLICATE|USER_SELECTED|POLICY_SELECTED"
}
```

Response:

```json
{
  "planId":"plan-...",
  "planFingerprint":"sha256:...",
  "cleanupMode":"TRASH|DELETE_PERMANENT",
  "items":[{
    "itemRef":"item-a",
    "identityToken":"opaque-identity-token",
    "sizeBytes":123
  }],
  "itemCount":1,
  "estimatedReclaimableBytes":123,
  "recoverable":true,
  "nativeConfirmation":"NEVER|MAY|ALWAYS",
  "adapterIdentity":{"adapterId":"...","adapterVersion":"...","platform":"..."}
}
```

The plan is immutable. Any material change creates a new `planId` and fingerprint.

### Fingerprint material

At minimum the fingerprint MUST cover, in canonical order:

- contract version;
- adapter id/version/platform;
- cleanup mode;
- ordered `(itemRef, identityToken, sizeBytes)` tuples;
- recoverability semantics.

The fingerprint algorithm is SHA-256 over a deterministic UTF-8 canonical representation. Implementations may choose JSON canonicalization or another frozen representation, but the representation must be documented and conformance-testable.

## `media.cleanup.execute`

Risk:

- `TRASH` or equivalent recoverable operation: `EXTERNAL_WRITE`.
- `DELETE_PERMANENT`: `DESTRUCTIVE_WRITE`.

Request:

```json
{
  "operationId":"op-...",
  "planId":"plan-...",
  "planFingerprint":"sha256:...",
  "idempotencyKey":"cleanup-..."
}
```

Execution invariants:

1. Explicit NaIA approval is required before dispatch.
2. Approval scope must bind to `planId`, fingerprint and cleanup mode.
3. Adapter must reload/revalidate plan material before mutation.
4. Each item identity must be revalidated immediately before mutation where the platform permits races.
5. Stale/altered plans fail as `STALE_CLEANUP_PLAN`.
6. Stale/replaced item references fail as `STALE_MEDIA_REFERENCE`.
7. Replay with the same `idempotencyKey` must not perform the destructive operation twice.
8. Platform-native consent/confirmation is an additional gate and must not be bypassed.
9. A requested recoverable mode must never silently become permanent deletion.

Response:

```json
{
  "operationId":"op-...",
  "planId":"plan-...",
  "cleanupMode":"TRASH|DELETE_PERMANENT",
  "requestedCount":2,
  "affectedCount":1,
  "skippedCount":1,
  "failedCount":0,
  "bytesReclaimed":123,
  "recoverable":true,
  "nativeConfirmationObserved":true,
  "outcomes":[{
    "itemRef":"item-a",
    "status":"AFFECTED|SKIPPED|FAILED",
    "errorCode":null
  }]
}
```

## Error taxonomy

Stable domain error codes:

- `INVALID_REQUEST`
- `PERMISSION_REQUIRED`
- `SOURCE_UNAVAILABLE`
- `UNSUPPORTED_OPERATION`
- `STALE_MEDIA_REFERENCE`
- `STALE_CLEANUP_PLAN`
- `APPROVAL_REQUIRED`
- `APPROVAL_SCOPE_MISMATCH`
- `NATIVE_CONFIRMATION_REQUIRED`
- `NATIVE_CONFIRMATION_DENIED`
- `PARTIAL_SUCCESS`
- `TRANSIENT_IO_FAILURE`
- `PERMANENT_IO_FAILURE`
- `IDEMPOTENCY_CONFLICT`
- `ADAPTER_FAILURE`

Native error text may appear only in minimized diagnostics and must not replace the stable code.

## Approval scopes

Canonical approval scope forms:

```text
media:cleanup:trash:<planId>:<fingerprint>
media:cleanup:permanent:<planId>:<fingerprint>
```

Approval for one scope cannot authorize the other.

## Evidence policy

Allowed by default:

- operation/plan ids;
- platform and adapter version;
- aggregate counts and bytes;
- duplicate/classification summaries;
- plan fingerprint;
- approval scope;
- stable error code;
- outcome counts;
- timestamps.

Excluded by default:

- raw media bytes;
- thumbnails;
- full EXIF/metadata dumps;
- arbitrary absolute filesystem paths when opaque refs suffice;
- auth tokens;
- OS consent handles;
- face embeddings or other biometric vectors.

## Compatibility rule

Contract v1 additions must be backward-compatible unless `contractVersion` changes. Adapters must reject unsupported future contract versions fail-closed.
