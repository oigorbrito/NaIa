# CHASSIS FORMAL ENVIRONMENT COMPARABILITY AUDIT — 2026-09-01

## Classification

- Scope: `CHASSIS_ONLY`
- Audit type: `STRUCTURAL_AUDIT`
- Runtime verification: `NOT_RUNTIME_VERIFIED`
- Formal protocol status: `SPECIFIED_NOT_EXECUTED`
- Formal ledger append: `CLOSED`
- Benchmark selection: `NOT_SELECTED`
- Chassis winner: `NOT_SELECTED`

This audit changes no candidate verdict and does not claim that any newly added test has executed successfully.

## Controlled-test boundary

- `LOCAL TEST HARNESS`
- `OWN REPOSITORY`
- `CONTROLLED FAULT INJECTION`
- `NO THIRD-PARTY TARGET`
- `NO CREDENTIAL BYPASS`
- `NO REAL-WORLD SERVICE DISRUPTION`

## Reproducibility basis

The protocol already cites NIST SP 1500-18r2 Research Data Framework and ACM artifact-evaluation/reproducibility guidance. Those sources support preserving software identity, execution environment, parameters, dependencies and provenance needed to reproduce computational experiments.

The new rule is therefore limited to variables already material to the execution environment or candidate runtime. It does not add an outcome-dependent screening rule.

## Finding E1 — revision and harness identity were necessary but not sufficient

The formal ledger already rejected:

- mixed verified Git repository revisions; and
- mixed aggregate formal harness SHA-256 identities.

However, two records could still report the same revision and harness while running under different Node, OS/kernel, architecture, installed SDK version or native runtime profile. Treating those records as identical replications would lose relevant execution-environment provenance.

## Finding E2 — pre-execution amendment A002 freezes environment comparability

`research/chassis/experiment-protocol.v1.json` now contains amendment `A002`:

- status: `FROZEN_BEFORE_FORMAL_EXECUTION`;
- policy: `single-common-runtime-and-candidate-profile-per-formal-ledger`;
- `outcomeDriven=false`;
- `changesSemanticVerdicts=false`;
- `changesRepetitionThreshold=false`.

The validator requires the exact frozen A001/A002 policy, date and constraint text. It also freezes the formal `requiredRecordFields` list. Silent weakening requires a versioned methodology change rather than editing the existing V1 rule after outcomes.

## Finding E3 — canonical identity separates common environment from candidate profile

Authority: `research/chassis/harness/formal-environment-identity.mjs`.

For every formal `READY` record it derives:

### Common execution identity

- OS plus observed release string;
- architecture;
- Node runtime;
- package-manager identity when recorded.

Every `READY` record admitted to one formal ledger must share this identity.

### Candidate execution profile

Within each candidate, every `READY` record must share:

- candidate version and source reference;
- adapter SHA-256;
- package-manifest SHA-256;
- exact expected, declared and installed execution-package versions;
- declared execution mode;
- worker-authority boundary;
- current candidate lifecycle-qualification SHA-256;
- stable native runtime identity observed by the lifecycle receipt.

Temporal stable native identity currently includes the frozen expected profile, observed platform, CLI SHA-256 and version output.

DBOS stable native identity currently includes observed platform, Docker version, frozen PostgreSQL image and inspected image identity.

## Finding E4 — ephemeral isolation fields are intentionally excluded

The canonical identity does not include per-run values that are expected to vary under correct isolation:

- absolute workspace paths;
- ports and database URLs;
- task queue names;
- process IDs;
- container IDs.

Structural tests explicitly vary these fields and require the canonical identity to remain unchanged.

This prevents isolation itself from being misclassified as environment drift.

## Finding E5 — environment drift closes candidate, ledger and selection gates

The environment consistency check is now applied at three boundaries:

1. `benchmarkEligible()` — candidate series comparability;
2. `appendRecordToLedger()` — next exact preregistered record admission;
3. `assessBenchmarkPromotion()` — final cross-candidate selection gate.

Examples that close the formal gate include:

- Node 22 versus Node 24 within one ledger;
- different OS/kernel release strings;
- different architecture;
- changed package-manager identity when recorded;
- installed dependency version mismatch;
- changed Temporal native version identity;
- changed DBOS Docker/PostgreSQL native runtime identity.

A mismatch is a comparability/provenance rejection. It is not a candidate `FAIL`.

## Finding E6 — lifecycle cleanup qualification also requires a valid environment identity

The isolated preregistered T5/r1 lifecycle receipt for Temporal and DBOS now requires a valid formal environment identity before it can qualify for separate cleanup-support promotion review.

The environment-identity authority is included in the candidate-specific `T5_R1_CLEANUP_SUPPORT_V1` lifecycle qualification bundle. Therefore changing that authority changes the lifecycle qualification SHA-256 and automatically invalidates stale support evidence under the existing current-bundle checks.

This does not require the earlier lifecycle-support Git revision to equal the later benchmark revision; A001 still permits earlier lifecycle qualification while its current candidate-specific qualification hash remains valid.

## Finding E7 — operational consequence of strict environment freeze

The common identity deliberately includes the observed OS release and Node runtime. If hosted-runner infrastructure changes those values during a 2,400-record formal series, the existing ledger must not silently continue as though the environment were unchanged.

The admissible response is to classify the series boundary explicitly and restart or create a new versioned execution series under the new environment. The gate must not be weakened after observing results merely to preserve accumulated repetitions.

## Structural evidence added

Source-level tests now cover:

- dynamic paths/ports/PIDs/queues/container IDs do not alter canonical identity;
- every frozen common-environment dimension contributes to the common hash;
- every frozen candidate-profile dimension contributes to the candidate hash;
- dependency/runtime drift closes candidate comparability;
- Temporal and DBOS may have distinct candidate profiles while sharing one common execution environment;
- formal ledger append rejects a cross-candidate Node-runtime drift;
- lifecycle promotion review recomputes and rejects an environment-incomplete T5/r1 receipt;
- frozen amendment constraint and required-record contract drift are rejected.

## Runtime status

All findings above remain source-level until a GitHub Actions runner actually starts the corresponding steps.

No new structural test is counted as PASS by this document.

Current decision state remains:

- Temporal lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- DBOS lifecycle: `IMPLEMENTED_NOT_RUNTIME_VERIFIED`;
- formal cleanup support: closed;
- formal ledger append: `CLOSED`;
- `BENCHMARK_TO_BEAT=NOT_SELECTED`;
- `CHASSIS_WINNER=NOT_SELECTED`.
