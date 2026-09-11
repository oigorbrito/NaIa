# Post-MVP Device Media Capability v1

Status: PLANNED_POST_MVP

Execution map: `docs/product/POST-MVP-MEDIA-EXECUTION-MAP-V1.md`

This roadmap item adds device media management to NaIA after the current MVP readiness gates are closed. It does not modify the frozen MVP core acceptance criteria.

## Product intent

NaIA should be able to act as a storage/media secretary on Android, iOS, and Windows. The user should ask NaIA for outcomes such as:

- scan my media;
- find duplicate photos/videos;
- identify reclaimable storage;
- classify media categories;
- prepare a cleanup plan;
- clean up duplicate/low-value media after explicit approval.

The user should not need to interact with a separate MiaClean product surface for normal NaIA workflows. MiaClean is treated as an implementation/reference engine, not as NaIA's product identity.

## Platform requirement

Support for all three target platforms is a first-class requirement from the contract design stage:

- Android: native implementation may reuse/refactor the existing `gmailum/MiaClean` engine and its MediaStore/SAF, hashing, classification and deletion capabilities.
- iOS: provide an equivalent native adapter using Apple platform media APIs and platform-native authorization/consent semantics.
- Windows: provide a native desktop adapter using Windows/filesystem media APIs, user-scoped file access, recycle-bin semantics where available, and platform-native authorization/confirmation where required.

NaIA core MUST NOT depend on Android-only, iOS-only, or Windows-only API vocabulary.

## Cross-platform capability contract

The NaIA-facing capability surface should remain platform-neutral:

- `media.scan`
- `media.duplicates.find`
- `media.classify`
- `media.storage.report`
- `media.cleanup.plan`
- `media.cleanup.execute`

Platform-specific details remain behind adapters. `media.cleanup.execute` receives the approved cleanup plan plus the requested cleanup mode; the platform adapter reports which modes are actually supported and any required system confirmation.

## Architecture

```text
User
  -> NaIA objective / planning
  -> NaIA policy / approval
  -> Device media capability contract
      -> Android media adapter (MiaClean-derived engine)
      -> iOS media adapter
      -> Windows media adapter
  -> platform authorization / confirmation where required
  -> result + minimized evidence
```

NaIA remains the authority layer. Platform adapters provide competence only.

## Authority and safety rules

1. Read-only operations (`scan`, duplicate discovery, classification, storage reporting, cleanup planning) do not require destructive-action approval.
2. Any operation that removes, trashes, hides, moves or otherwise mutates user media requires explicit NaIA approval.
3. Platform-native consent/authorization MUST NOT be bypassed. NaIA approval and OS authorization are separate gates.
4. A cleanup plan MUST be inspectable before mutation and tied to the exact media set/action being approved.
5. Approval MUST NOT automatically transfer to a materially different media set or cleanup mode.
6. Raw photos/videos should not be persisted in NaIA evidence. Evidence should prefer aggregate counts, stable operation ids, sizes, categories and outcomes.
7. Secrets, access tokens and platform authorization artifacts remain runtime-only.
8. On Windows, permanent deletion MUST be treated as distinct from recycle-bin/trash behavior and require an appropriately stronger approval scope.

## Implementation direction

Do not merge the entire MiaClean Android app into NaIA. Separate reusable media-domain/engine code from product UI concerns.

Reuse candidates from MiaClean include:

- scan orchestration;
- exact/perceptual duplicate detection;
- duplicate grouping/ranking;
- media classification;
- storage/reclaimable-space computation;
- Android deletion/trash adapter.

Do not pull MiaClean-specific concerns into NaIA core unless independently required:

- Compose navigation/UI;
- onboarding;
- freemium/paywall and Play Billing;
- standalone settings/product identity;
- launcher widgets unrelated to NaIA workflows.

For iOS and Windows, implement the same NaIA capability contract natively rather than attempting to emulate Android storage semantics.

## Proposed delivery waves

### MEDIA-01 — legal/source freeze

- pin the exact MiaClean revision used for evaluation;
- resolve repository license/ownership for reuse and distribution;
- inventory reusable `shared` and Android-native components.

### MEDIA-02 — contract first

- freeze request/response schema for the six `media.*` capabilities;
- freeze risk classes and approval semantics;
- define platform capability discovery and unsupported-mode behavior;
- define one conformance suite that every platform adapter must satisfy.

### MEDIA-03 — Android read-only

- integrate scan;
- duplicate discovery;
- classification;
- storage report;
- cleanup plan;
- demonstrate NaIA -> Android adapter -> result end-to-end without destructive action.

### MEDIA-04 — iOS read-only

- implement the same read-only contract on iOS;
- demonstrate equivalent end-to-end behavior;
- document platform differences without leaking them into NaIA core.

### MEDIA-05 — Windows read-only

- implement the same read-only contract on Windows;
- support user-selected folders/libraries and supported media locations;
- demonstrate equivalent end-to-end behavior;
- document platform differences without leaking them into NaIA core.

### MEDIA-06 — Android cleanup

- bind cleanup execution to explicit NaIA approval;
- preserve Android system confirmation where applicable;
- verify replay/idempotency and evidence minimization.

### MEDIA-07 — iOS cleanup

- bind iOS cleanup execution to explicit NaIA approval;
- preserve platform-native authorization/confirmation;
- verify replay/idempotency and evidence minimization.

### MEDIA-08 — Windows cleanup

- bind Windows cleanup execution to explicit NaIA approval;
- prefer recycle-bin/recoverable cleanup where supported;
- distinguish recoverable trash from permanent deletion in policy and approval scope;
- verify replay/idempotency and evidence minimization.

### MEDIA-09 — cross-platform conformance

- run the same capability contract tests against Android, iOS, and Windows adapters;
- verify identical policy behavior for equivalent operations;
- record documented platform-specific capability differences;
- require real-device/runtime E2E on at least one supported Android device, one supported iOS device, and one supported Windows machine before declaring the capability production-ready.

## Acceptance criteria

This roadmap item is accepted only when:

1. Android, iOS, and Windows all implement the same NaIA-facing `media.*` contract.
2. Read-only operations are usable without destructive approval.
3. Cleanup operations cannot execute before explicit NaIA approval.
4. Platform-native consent/authorization remains enforced where applicable.
5. Approval is scoped to the intended media set/action.
6. Raw media is not copied into NaIA evidence by default.
7. Cross-platform contract tests pass for all three adapters.
8. Android real-device E2E passes.
9. iOS real-device E2E passes.
10. Windows real-machine E2E passes.
11. Recoverable cleanup and permanent deletion are represented as distinct policy outcomes where the platform supports that distinction.
12. Licensing/redistribution status of reused MiaClean code is resolved before shipping.

## MVP relationship

This is deliberately POST-MVP. The current `MVP_CORE_READY` contract remains frozen and is not expanded by this roadmap item. Work on this capability begins after the existing MVP readiness gates have produced observed PASS evidence, except for documentation/research that does not alter the frozen MVP implementation.
