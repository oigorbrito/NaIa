# Post-MVP Media Source Freeze v1

Status: MEDIA-01 / SOURCE_FROZEN / LEGAL_BLOCKED

This artifact freezes the MiaClean source revision evaluated for the NaIA post-MVP device-media capability. It is documentation/research only and does not modify the frozen MVP readiness contract.

## Source identity

Repository:

`gmailum/MiaClean`

Pinned revision:

`24a555652deb2d6dba239650af227b7138c6fa6b`

This exact revision is the only MiaClean source baseline referenced by this document. A later MiaClean revision requires a new source-freeze artifact or an explicit versioned update.

## Legal / redistribution status

Current classification:

`BLOCKED_EXTERNAL / LEGAL_DECISION_REQUIRED`

Observed at the pinned revision:

- `README.md` contains `License: TBD`;
- no root `LICENSE` file is present at the pinned revision.

Therefore:

1. public GitHub visibility MUST NOT be treated as permission to copy, modify, redistribute or ship MiaClean code inside NaIA;
2. no MiaClean source should be copied into the NaIA product tree until ownership/license/redistribution status is explicitly resolved;
3. architecture and clean-room-compatible contract design may continue because they do not require copying source;
4. if the same owner controls both projects, the decision should still be recorded as a concrete license/ownership artifact before distribution.

Legal resolution is a shipping gate for reused MiaClean code, not a reason to block independent NaIA media-contract work.

## Observed architecture at pinned revision

The repository contains both:

- `:app` — Android application/runtime;
- `:shared` — Kotlin Multiplatform library targetting Android plus iOS (`iosX64`, `iosArm64`, `iosSimulatorArm64`).

This is a favorable reuse signal: some duplicate/hash/domain logic is already being moved toward platform-neutral code.

However, the separation is incomplete. The `shared` module still contains and imports domain types in package `com.miaclean.app.domain`, so NaIA MUST NOT assume that `:shared` is already a clean standalone engine boundary.

## Reuse inventory

### Candidate A — duplicate grouping/ranking/selection

Examples at the pinned revision:

- `shared/src/commonMain/kotlin/com/miaclean/shared/dedup/DuplicateContracts.kt`
- `shared/src/commonMain/kotlin/com/miaclean/shared/dedup/DuplicateOrchestrator.kt`
- default grouping/ranking/selection implementations in the same package.

Disposition:

`STRONG_REUSE_CANDIDATE`

Required before reuse:

- detach contracts from app-specific package/type naming;
- ensure no Android APIs leak into common contracts;
- map outputs to NaIA `media.duplicates.find` schema rather than exposing MiaClean domain objects directly.

### Candidate B — hash orchestration

Observed shared package:

- `com.miaclean.shared.hash`

Disposition:

`REUSE_CANDIDATE`

Required before reuse:

- distinguish exact hash from perceptual/semantic similarity in the NaIA contract;
- keep platform-specific image decoding outside the shared NaIA-facing contract;
- document deterministic/non-deterministic properties of each algorithm.

### Candidate C — media classification heuristics

Observed common code includes classification/evaluator logic and categories such as screenshot, selfie, meme, document, photo, video and other.

Disposition:

`REUSE_WITH_NORMALIZATION`

Rules:

- classification remains best-effort, never ground truth;
- NaIA response should carry provenance/confidence/unknown where available;
- platform-specific ML engines remain adapters, not core domain dependencies.

### Candidate D — Android scanning

Observed Android implementation uses MediaStore and SAF, including WhatsApp-oriented scanning.

Disposition:

`ANDROID_ADAPTER_ONLY`

Rules:

- do not expose `MediaStore`, SAF URI semantics or Android permission names to NaIA core;
- map discovered items to opaque platform references under `media.scan`;
- source scope must be user-visible/authorized.

### Candidate E — Android trash/delete execution

Observed Android deletion code uses platform APIs and system consent paths.

Disposition:

`ANDROID_MUTATION_ADAPTER_ONLY`

Rules:

- preserve OS confirmation;
- keep recoverable trash distinct from permanent delete;
- require approved NaIA cleanup plan/fingerprint before execution;
- never make Android deletion semantics the cross-platform contract.

### Candidate F — UI/billing/product shell

Includes Compose navigation/UI, onboarding, widgets, standalone settings, entitlement/paywall and Play Billing.

Disposition:

`DO_NOT_REUSE_IN_NAIA_CORE`

These are MiaClean product-shell concerns, not device-media competence required by NaIA.

## Cross-platform implications

### Android

MiaClean is the primary implementation/reference candidate.

### iOS

The existing `:shared` KMP targets are useful evidence that some algorithms can be cross-platform, but iOS still requires a native adapter for media authorization, discovery, references and mutation semantics.

### Windows

Windows is not a current MiaClean runtime target. NaIA must implement a native Windows adapter against the same `media.*` contract. Reusable algorithmic ideas may be ported/reimplemented only after legal/source status is resolved when source reuse is involved.

## Extraction boundary target

The desired post-MVP architecture is:

```text
NaIA media.* contract
        |
        +-- platform-neutral algorithms/contracts
        |     - duplicate grouping
        |     - ranking/selection
        |     - normalized classification rules where portable
        |     - hash orchestration contracts
        |
        +-- Android adapter
        |     - MediaStore / SAF / Android consent
        |
        +-- iOS adapter
        |     - Apple-native media/file APIs and consent
        |
        +-- Windows adapter
              - approved filesystem/library roots
              - recycle-bin/permanent delete semantics
```

NaIA core does not import MiaClean product UI/domain objects directly.

## Reproducibility record

Every future reuse evaluation must record:

- MiaClean repository and exact SHA;
- files/components evaluated;
- license/ownership decision artifact;
- modifications or clean-room reimplementation choice;
- platform(s) using the component;
- conformance-test result against the versioned NaIA `media.*` contract.

## MEDIA-01 result

Claim: a reproducible source baseline can be frozen without changing the MVP.

Hypothesis: the pinned MiaClean revision contains identifiable reusable engine components and enough source metadata to classify legal/architectural blockers.

Procedure: inspect the pinned README, module configuration and representative common dedupe/domain files; verify license-file status.

Observed result:

- source SHA pinned: `PASS`;
- reusable-component inventory: `PASS`;
- KMP Android/iOS foundation observed: `PASS`;
- clean engine separation already complete: `FAIL` — shared code still has app-domain coupling;
- license/redistribution decision: `BLOCKED_EXTERNAL / LEGAL_DECISION_REQUIRED`.

Decision:

`MEDIA-01_ENGINEERING_BASELINE = PASS`

`MEDIA-01_LEGAL_GATE = BLOCKED_EXTERNAL`

MEDIA-02 contract work may proceed after MVP closure without copying MiaClean source. Shipping reused MiaClean code remains blocked until the legal gate is resolved.
