# Relay minimal chassis comparison v1

Issue: #80

## Decision

`MIGRATION_NOT_JUSTIFIED_V1`

The Relay-inspired spike now demonstrates useful runtime patterns, including real file-backed resume and NaIA-compatible confirmation -> approval ordering. However, replacing the current product chassis is not justified by the measured maintenance surface at this stage.

## Scope of the comparison

The comparison intentionally excludes product capability implementations and natural-language parsing that would remain necessary on either chassis. The current-chassis LOC baseline therefore includes only:

- `src/product/service.mjs`
- `src/product/domain.mjs`
- `src/product/ports.mjs`
- `src/product/policy.mjs`

The Relay spike baseline includes only:

- `research/chassis/harness/relay-minimal-runtime.mjs`

`planner.mjs` and `tools.mjs` are excluded from both sides because model/tool selection and capability implementations do not disappear when an execution chassis changes.

## Measured owned surface

| Surface | Total lines | Nonblank code lines | Bytes |
| --- | ---: | ---: | ---: |
| Current NaIA runtime (`service+domain+ports+policy`) | 393 | 363 | 16,059 |
| Relay-inspired minimal runtime | 311 | 279 | 10,366 |
| Raw difference | -82 (-20.9%) | -84 (-23.1%) | -5,693 (-35.5%) |

The raw reduction is real but is **not residual migration savings**. A production replacement would still need compatibility surfaces that the current Relay spike does not own.

## Behavioral comparison

| Property | Current product runtime | Relay spike v1 |
| --- | --- | --- |
| Planner port | Yes | Yes |
| Policy port | Yes | Yes |
| Provider-neutral execution port | Yes | Yes |
| Read-only/write approval gate | Yes | Yes |
| Confirmation before approval | Yes | Yes (added by #80 spike) |
| Durable restart across service instance | Product file ports | Yes (file-backed Relay run store added by #80 spike) |
| Resume skips completed work | Yes | Yes |
| Stable NaIA run identity across retry/restart | Objective identity | Yes (`runId`) |
| Stable provider run identity across transient retry | Not modeled by current local execution core | Yes |
| Explicit full provider restart identity | Not modeled by current local execution core | Yes |
| Required output contract | Capability-specific today | Yes, runtime-level |
| Cumulative token/cost accounting across attempts | External/model metering layers | Yes, runtime-level |
| Normalized lifecycle event ledger | Evidence records | Yes, embedded event ledger |
| Feature-flag enforcement/evidence | Yes | Not in Relay spike |
| Unknown-tool / risk-mismatch policy | Yes | Reusable current policy, but not owned by Relay spike itself |
| `pursueAction` product API | Yes | No direct compatibility facade |
| `get/history` product API | Yes | `status` only |
| Dynamic capability registration | Yes | No direct compatibility facade |

## Persistence/state-model comparison

Current product runtime persists three primary runtime concepts:

1. objective;
2. plan;
3. append-only evidence.

The Relay spike persists one aggregate run containing:

- plan;
- approvals/confirmations;
- lifecycle events;
- provider/run identity;
- retry/restart counters;
- usage;
- step outputs/files.

This is a meaningful simplification of persistence concepts. It also changes storage granularity and would require migration/adapters for current history/evidence consumers, so the one-record model is not free savings.

## Compatibility evidence added in this spike

The spike test suite now covers:

- confirmation -> approval -> execution ordering matching `createNaiaService`;
- no execution before both gates;
- confirmation mismatch fails closed;
- file-backed restart between independent runtime instances;
- completed read step is not repeated after restart;
- NaIA `runId` and provider run identity survive ordinary process/runtime restart;
- transient retry keeps provider run identity;
- explicit full restart changes provider run identity;
- cumulative token/cost usage;
- required-output fail-closed behavior.

## Residual compatibility work required for a real migration

A production migration would still require at least:

- feature-flag decision/evidence hook;
- current `pursue` / `pursueAction` facade compatibility;
- `get` / `history` projections;
- dynamic tool/capability registration integration;
- reuse or adaptation of current unknown-tool/risk-mismatch policy;
- migration/projection of historical objective/plan/evidence data;
- validation that all product tests can run against the alternate runtime facade.

That glue would consume a substantial portion of the observed 82-line raw reduction and introduce migration/test burden. Therefore the measured evidence does not support claiming a material reduction in NaIA-owned maintenance surface.

## Winning patterns to retain

The experiment does identify patterns worth incorporating independently of chassis replacement:

1. explicit provider-run identity distinct from NaIA objective/run identity;
2. bounded transient retry vs explicit full restart;
3. runtime-level required-output validation for workflows that produce artifacts;
4. cumulative usage/cost accounting across retries/restarts;
5. a normalized provider-neutral lifecycle event vocabulary;
6. aggregate-run persistence as an optional execution receipt/projection, not necessarily the sole product store.

## Gate result

The #80 migration gate requires equivalent behavior **and** materially lower residual owned complexity/maintenance. The spike now demonstrates substantial behavioral compatibility, but the measured raw LOC reduction is modest and disappears further once required product compatibility glue is counted.

Result:

`RELAY_MINIMAL_CHASSIS = USEFUL_PATTERN_SOURCE / FULL_MIGRATION_NOT_JUSTIFIED_V1`

This result does not select the current chassis permanently. A different complete runtime can still replace it if a future benchmark shows a materially better residual maintenance/performance profile.
