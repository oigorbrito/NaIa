# Post-MVP Mobile Media Capability v1

Status: PLANNED_POST_MVP

This roadmap item adds device media management to NaIA after the current MVP readiness gates are closed. It does not modify the frozen MVP core acceptance criteria.

## Product intent

NaIA should be able to act as a mobile storage/media secretary on both Android and iOS. The user should ask NaIA for outcomes such as:

- scan my media;
- find duplicate photos/videos;
- identify reclaimable storage;
- classify media categories;
- prepare a cleanup plan;
- clean up duplicate/low-value media after explicit approval.

The user should not need to interact with a separate MiaClean product surface for normal NaIA workflows. MiaClean is treated as an implementation/reference engine, not as NaIA's product identity.

## Platform requirement

Support for both platforms is a first-class requirement from the contract design stage:

- Android: native implementation may reuse/refactor the existing `gmailum/MiaClean` engine and its MediaStore/SAF, hashing, classification and deletion capabilities.
- iOS: provide an equivalent native adapter using Apple platform media APIs and platform-native authorization/consent semantics.

NaIA core MUST NOT depend on Android-only or iOS-only API vocabulary.

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
  -> Mobile media capability contract
      -> Android media adapter (MiaClean-derived engine)
      -> iOS media adapter
  -> platform authorization / confirmation where required
  -> result + minimized evidence
```

NaIA remains the authority layer. Mobile adapters provide competence only.

## Authority and safety rules

1. Read-only operations (`scan`, duplicate discovery, classification, storage reporting, cleanup planning) do not require destructive-action approval.
2. Any operation that removes, trashes, hides, moves or otherwise mutates user media requires explicit NaIA approval.
3. Platform-native consent dialogs MUST NOT be bypassed. NaIA approval and OS authorization are separate gates.
4. A cleanup plan MUST be inspectable before mutation and tied to the exact media set/action being approved.
5. Approval MUST NOT automatically transfer to a materially different media set or cleanup mode.
6. Raw photos/videos should not be persisted in NaIA evidence. Evidence should prefer aggregate counts, stable operation ids, sizes, categories and outcomes.
7. Secrets, access tokens and platform authorization artifacts remain runtime-only.

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

For iOS, implement the same NaIA capability contract natively rather than attempting to emulate Android storage semantics.

## Proposed delivery waves

### MEDIA-01 — legal/source freeze

- pin the exact MiaClean revision used for evaluation;
- resolve repository license/ownership for reuse and distribution;
- inventory reusable `shared` and Android-native components.

### MEDIA-02 — contract first

- freeze request/response schema for the six `media.*` capabilities;
- freeze risk classes and approval semantics;
- define platform capability discovery and unsupported-mode behavior.

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

### MEDIA-05 — Android cleanup

- bind cleanup execution to explicit NaIA approval;
- preserve Android system confirmation where applicable;
- verify replay/idempotency and evidence minimization.

### MEDIA-06 — iOS cleanup

- bind iOS cleanup execution to explicit NaIA approval;
- preserve platform-native authorization/confirmation;
- verify replay/idempotency and evidence minimization.

### MEDIA-07 — cross-platform conformance

- run the same capability contract tests against Android and iOS adapters;
- verify identical policy behavior for equivalent operations;
- record documented platform-specific capability differences;
- require real-device E2E on at least one supported Android device and one supported iOS device before declaring the capability production-ready.

## Acceptance criteria

This roadmap item is accepted only when:

1. Android and iOS both implement the same NaIA-facing `media.*` contract.
2. Read-only operations are usable without destructive approval.
3. Cleanup operations cannot execute before explicit NaIA approval.
4. Platform-native consent remains enforced.
5. Approval is scoped to the intended media set/action.
6. Raw media is not copied into NaIA evidence by default.
7. Cross-platform contract tests pass for both adapters.
8. Android real-device E2E passes.
9. iOS real-device E2E passes.
10. licensing/redistribution status of reused MiaClean code is resolved before shipping.

## MVP relationship

This is deliberately POST-MVP. The current `MVP_CORE_READY` contract remains frozen and is not expanded by this roadmap item. Work on this capability begins after the existing MVP readiness gates have produced observed PASS evidence, except for documentation/research that does not alter the frozen MVP implementation.
