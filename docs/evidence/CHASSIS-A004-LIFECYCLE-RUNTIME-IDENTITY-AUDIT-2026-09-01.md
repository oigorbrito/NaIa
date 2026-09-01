# CHASSIS A004 LIFECYCLE RUNTIME IDENTITY AUDIT — 2026-09-01

## Scope

- `CHASSIS_ONLY`
- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Work unit

`CHASSIS_A004_LIFECYCLE_RUNTIME_IDENTITY_ENFORCEMENT_AUDIT_V1`

Audit source head before this evidence note:

`c975a2fcc21754af8e84cdd86a57184cb484be9d`

Protocol amendment under audit:

- `A004`
- policy: `lifecycle-qualification-runtime-identity-must-match-formal-candidate-runtime`
- frozen before formal benchmark execution on `2026-09-01`

No new protocol amendment was introduced by this audit. The work below enforces the already-frozen A004 rule.

## Audit finding

The protocol validator already hard-gated A004, but the rule was not end-to-end executable.

Before this audit:

1. formal environment identity included native runtime evidence inside the candidate profile hash but did not expose a dedicated stable native-runtime hash;
2. the T5/r1 lifecycle receipt did not publish that dedicated hash;
3. lifecycle promotion evidence did not persist it;
4. `FORMAL_CLEANUP_SUPPORT` did not require it;
5. formal ledger admission did not compare a READY record runtime to the runtime that qualified lifecycle cleanup support;
6. benchmark eligibility did not perform that comparison for each required critical record.

Therefore A004 was a frozen protocol claim with incomplete executable enforcement.

## Enforcement implemented

### 1. Canonical native runtime identity

`formal-environment-identity.mjs` now exposes `runtimeIdentitySha256` derived only from the stable native runtime identity object already used by the formal candidate profile.

Dynamic workspace paths, ports, PIDs, task queues, container IDs and database URLs remain excluded from this identity.

The runtime hash is fail-closed: if the formal environment identity is invalid, `runtimeIdentitySha256` is not produced.

### 2. T5/r1 qualification receipt

`formal-lifecycle-runtime-receipt-validator.mjs` now:

- exposes the recomputed `runtimeIdentitySha256`;
- requires a valid SHA-256 through `formalRuntimeIdentitySha256Present`;
- includes that check in `eligibleForLifecycleStatusPromotion`.

A lifecycle qualification therefore cannot proceed without an executable native runtime identity.

### 3. Promotion evidence binding

`formal-lifecycle-promotion-review.mjs` now:

- recomputes the runtime identity from the qualification record;
- requires a valid runtime identity SHA-256;
- requires the supplied validator artifact to contain the same recomputed runtime identity SHA-256;
- persists `runtimeIdentitySha256` in `verificationEvidence` only when all promotion-review checks pass.

This keeps candidate semantic verdict separate from lifecycle qualification and still forbids automatic benchmark promotion, ledger append or repository mutation.

### 4. Cleanup support evidence

`formal-cleanup-support.mjs` now requires `verificationEvidence.runtimeIdentitySha256` for evidence-backed `RUNTIME_VERIFIED` cleanup support.

The module also exposes `assessLifecycleRuntimeIdentityBinding()`.

For a READY formal record, that assessment compares:

- expected runtime identity: the T5/r1 qualification runtime hash persisted in cleanup-support evidence;
- observed runtime identity: the hash recomputed from the current READY record.

A mismatch is rejected explicitly.

For non-READY records the comparison is not applied. This preserves the protocol distinction between setup blockers and candidate outcomes: a blocked execution is not converted into PASS or FAIL by A004.

### 5. Formal ledger admission

`formalLedgerAdmission()` applies the A004 runtime identity binding as part of current frozen-state compatibility.

A READY record cannot enter the formal ledger when its stable native runtime identity differs from the runtime that qualified lifecycle cleanup support.

Historical immutable audit remains separate from current compatibility. The audit does not relabel old evidence as tampering merely because the current qualification state changes.

### 6. Benchmark eligibility

`benchmarkEligible()` applies the same A004 binding to every required critical repetition.

A candidate cannot become benchmark-eligible by running all repetitions on a new but internally consistent native runtime that differs from the runtime used for T5/r1 lifecycle qualification.

This closes the gap that candidate-profile consistency alone could not close: internal consistency of a benchmark series is not sufficient when the series is inconsistent with its qualifying runtime artifact.

## Adversarial tests defined

The structural test suite includes explicit cases for:

- missing qualification runtime identity hash;
- tampered validator runtime identity hash;
- READY ledger record with a structurally valid but different native runtime identity;
- benchmark record with a structurally valid but different native runtime identity;
- promotion series whose runtime is internally stable but differs from the qualification runtime;
- readiness/promotion evidence without the A004 runtime identity hash;
- dynamic paths, ports, PIDs, queues and container IDs not changing the native runtime identity hash;
- native runtime changes changing the native runtime identity hash;
- invalid formal environment identity producing no runtime identity hash.

Legacy test fixtures that duplicated old candidate profiles or cleanup evidence were normalized to the shared frozen-profile fixtures so that tests do not define an accidental second authority.

## Reproducibility controls preserved

This change does not alter:

- critical mutant set;
- minimum repetition threshold;
- preregistered round-robin order;
- PASS/FAIL/BLOCKED/INCONCLUSIVE semantics;
- candidate-agnostic evaluator authority;
- promotion exception policy;
- single-revision policy;
- common environment policy.

No benchmark-only shim or private runtime state mutation was introduced.

The design remains consistent with the existing project methodology based on reproducibility metadata, software/runtime versioning, provenance and frozen execution conditions.

## Continuity audit after initial A004 note

A follow-up audit found a temporal continuity gap after the initial enforcement note.

A newly admitted READY record was already checked against the current runtime-verified cleanup-support identity, and benchmark eligibility also rechecked every required critical record. However, when continuing an existing formal ledger prefix, `appendRecordToLedger()` revalidated old records through `assessStoredFormalLedgerCurrentCompatibility()` without passing the current cleanup-support authority into an A004 runtime-identity comparison.

That meant a previously admitted READY prefix could remain marked current-compatible after the cleanup-support `verificationEvidence.runtimeIdentitySha256` for its candidate changed, until a later candidate-specific admission or final benchmark gate rejected the mismatch.

This was an enforcement gap in current-state continuity, not a new experimental rule.

The gap was closed by:

- `025e9ef9f0e73a6e04173c51ca84abfc3bc792e2` — `fix(chassis): revalidate ledger runtime identity on continuation`
  - `assessStoredFormalRecordCurrentCompatibility(record, cleanupSupport)` now reapplies A004 for READY records;
  - `assessStoredFormalLedgerCurrentCompatibility(records, cleanupSupport)` propagates the current support authority across the stored prefix;
  - `appendRecordToLedger()` passes the same current support authority into both pre-append and post-append compatibility checks;
  - `formalLedgerAdmission()` reuses this current-compatibility authority rather than maintaining a second independent runtime-binding path.
- `1815aa9b21ae84ea5c6848bc04d570fa1aa27dda` — `test(chassis): reject rotated runtime identity for stored ledger prefix`
  - defines regression cases for one stored READY record and a stored ledger prefix that were valid under one qualified runtime identity and become incompatible when only the current qualification runtime hash rotates.
- `3e5781861ba732859b5db697c803f1e82421ef68` — `ci(chassis): gate ledger runtime identity continuity`
  - wires the new regression test into the structural chassis workflow.

No A005 was introduced. The correction enforces the existing A004 policy across ledger continuation.

## Remote execution status

Initial inspected workflow for source head `c975a2fcc21754af8e84cdd86a57184cb484be9d`:

- run: `33561714797`
- `neutral-oracle (22)`: `failure`, `steps=null`
- `neutral-oracle (24)`: `cancelled`, `steps=null`

Latest inspected workflow after the continuity closure, for source head `3e5781861ba732859b5db697c803f1e82421ef68`:

- run: `33562396617`
- `neutral-oracle (22)`: `failure`, `steps=null`
- `neutral-oracle (24)`: `cancelled`, `steps=null`

Classification:

`REMOTE_CI = BLOCKED_REMOTE_CI_PRE_RUNNER`

No A004 test step executed in either inspected run. Therefore this audit does **not** claim remote runtime PASS.

Current evidence status:

`A004_ENFORCEMENT = STRUCTURALLY_IMPLEMENTED_NOT_REMOTE_EXECUTED`

`A004_LEDGER_CONTINUITY = STRUCTURALLY_IMPLEMENTED_NOT_REMOTE_EXECUTED`

`FORMAL_RUNTIME_VERIFICATION = NOT_OBTAINED_FROM_BLOCKED_CI`

## Formal decision state

Unchanged:

- `FORMAL_LEDGER_APPEND = CLOSED`
- `BENCHMARK_TO_BEAT = NOT_SELECTED`
- `CHASSIS_WINNER = NOT_SELECTED`

No candidate receives PASS, FAIL, benchmark status or winner status from this audit.
