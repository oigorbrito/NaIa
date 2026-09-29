# Project Research State — 2026-09-29

Status: **AUTHORITATIVE RESEARCH INDEX / NOT A PROMOTION DECISION**

Purpose: prevent project decisions, test outcomes, and qualification status from depending on chat memory.

This file records where the evidence lives, what has actually been demonstrated, what remains provisional, and which conclusions exist only in open research branches.

## Source-of-truth rule

For every future implementation or research task:

1. Read this file.
2. Read the linked research artifact/PR for the relevant domain.
3. Verify the pinned upstream revision before relying on a candidate claim.
4. Treat chat summaries as navigation only, never as the evidence record.
5. Do not convert an in-progress qualification into a winner.

```text
CHAT MEMORY != PROJECT EVIDENCE
PR/DOC != MERGED MAIN
BENCHMARK_SIGNAL != LOCAL_PROOF
IMPLEMENTED != QUALIFIED
QUALIFIED != PROMOTED
```

---

## Current product architecture hypothesis

Nayara is one product with two separately authorized bounded contexts:

```text
                   NAYARA PRODUCT
                        |
            +-----------+-----------+
            |                       |
   PERSONAL ASSISTANT          THERAPIST
            |                       |
            +------ HANDOFF --------+
                   BROKER
```

The two systems may live in one repository but must not share unrestricted:

- memory;
- credentials;
- tools;
- execution authority;
- private session state.

Cross-domain communication must be explicit, minimal, auditable, and consent-aware where appropriate.

This is a product architecture hypothesis, not proof that both systems must share one runtime, database, language, or framework.

---

## Evidence-first methodology

### Artifact

Open draft PR **#187**  
Branch: `docs/evidence-first-engineering-2026-09-29`  
Head observed during this audit: `cf04ad2cd090e14eee5e021b98b6962e0aaa3c0c`

Primary document:

`docs/research/EVIDENCE-FIRST-ENGINEERING.md`

It also changes:

- `README.md`
- `AGENTS.md`

### Status

`DOCUMENTED_REMOTE = YES`  
`MERGED_MAIN = NO`

### Core method

```text
EXTERNAL_EVIDENCE
        ↓
RELEVANCE / TRANSFER CHECK
        ↓
REUSE PROVEN MECHANISM
        ↓
TEST ONLY MATERIAL LOCAL DELTAS
        ↓
LOCAL ACCEPTANCE
```

Context7 is an auxiliary source for current library/framework documentation. Academic/clinical benchmark claims should prefer primary papers, benchmark repositories, datasets, and released evaluation artifacts.

---

## Historical chassis / durable-execution research

The repository `main` already contains substantial durable-execution research, including:

- `docs/research/CHASSIS-CANDIDATES-V1.md`
- `docs/research/CHASSIS-QUALIFICATION-PROTOCOL.md`
- `docs/research/FAULT-MUTANTS-T1-T16.md`
- `research/chassis/EMPIRICAL-HARNESS-METHODOLOGY-V1.md`
- T5/T11/T12/T16 contracts;
- Temporal / DBOS / Restate / Trigger.dev adapters;
- formal harness and evidence validators;
- historical evidence under `docs/evidence/` and `research/chassis/evidence/`.

Important invariant retained from this work:

```text
PERSISTENCE != DURABLE EXECUTION
```

### 2026-09-29 harness revalidation

Open draft PR **#186**  
Branch: `research/chassis-harness-repair-2026-09-29`  
Head observed: `a0f2f415cba23456ff702c7a698a2eb3b9c643f0`

Observed rerun baseline recorded in PR:

- 392 harness tests;
- 348 passed;
- 44 failed.

Those failures were classified as harness/fixture problems and **not candidate failures**.

Repairs recorded in the branch:

- Temporal cleanup mapping bug;
- DBOS cleanup mapping bug;
- A003/A004 formal-single-run fixture drift.

The branch remained red because additional harness/provenance prerequisites still existed, including missing adapter lockfile/provenance evidence.

`CHASSIS_WINNER = NOT_SELECTED`

### Status

Historical protocol/evidence: `MERGED_MAIN = YES`  
Latest harness repair: `DOCUMENTED_REMOTE = YES, MERGED_MAIN = NO`

The project has since shifted from broad chassis experimentation toward selecting complete product bases and using these durability tests as qualification/regression gates.

---

## Therapeutic-base qualification

Open draft PR **#188**  
Branch: `research/therapy-base-qualification-2026-09-29`  
Head observed: `6883f85ecaea9b939809562500424c569aa349de`

Primary document:

`docs/research/THERAPY-BASE-QUALIFICATION-2026-09-29.md`

### Current disposition

```text
PsychAgent = TECHNICAL_LEAD / ADOPTION_HOLD
TheraMind = DONOR / NOT_PREFERRED_AS_BASE
PsyLLM = MODEL/DATA DONOR
AgentMental = INFORMATION-GAP MECHANISM DONOR
PATIENT-Ψ = EVALUATION/SIMULATION DONOR
PsychEval = LONGITUDINAL QUALITY GATE
CounselBench = QUALITY/ADVERSARIAL GATE
MHSafeEval = SAFETY GATE
```

PsychAgent is not selected for production yet.

Current HOLD reasons:

- repository license unresolved;
- checkpoint license unresolved/marked `other`;
- no qualified crisis/safety runtime;
- demo-grade auth/privacy surface;
- no separate published reserved/evasive subgroup proof;
- Portuguese transfer not demonstrated.

Material local tests retained:

- Portuguese transfer;
- reserved/evasive subgroup;
- information-gap behavior;
- assistant/therapy role boundary;
- safety layer integration;
- therapy-memory isolation.

### Status

`DOCUMENTED_REMOTE = YES`  
`MERGED_MAIN = NO`

---

## Assistant-base qualification

Detailed record:

`docs/research/ASSISTANT-BASE-QUALIFICATION-2026-09-29.md`

Current shortlist:

```text
A — OpenMausBot
B — NaIA
C — OpenClaw
```

Current state:

```text
OpenMausBot = STRONG_BASE / REQUIRES_AUTHORITY_AND_DURABILITY_REINFORCEMENT
NaIA        = ARCHITECTURAL_DONOR / HIGHER_PRODUCT_BUILD_COST
OpenClaw    = STRONG_CANDIDATE / QUALIFICATION_IN_PROGRESS
WINNER      = NOT_SELECTED
```

The OpenClaw investigation was intentionally left incomplete at the chat handoff and must be resumed before any assistant-base selection.

---

## Current candidate revisions observed

These are provenance anchors, not permanent "latest" values. Re-check upstream before implementation.

- NaIA main: `23e4ca55abfaf399844047792018a22415ed3738`
- OpenMausBot qualified snapshot: `947bef311bf5c3f55d3590849abf0eb329408519`
- PsychAgent qualified snapshot: `469f45ef468b968b3fccd1936d7e6a0a574e4c5c`
- TheraMind qualified snapshot: `416d0a00ecc8c76229512197765dc95be6513de5`
- OpenClaw HEAD observed when qualification began: `df97da27f07f6655d5678bdbf1f6f9e460678013`

Never assume these are still current.

---

## What is deliberately NOT decided

The following are not project facts yet:

- OpenMausBot is the selected assistant base.
- OpenClaw is the selected assistant base.
- PsychAgent is approved for production use.
- Temporal/DBOS/Restate/Trigger.dev is the selected durable runtime.
- The therapist and assistant must use one runtime.
- The final repository topology must be monorepo.
- External-effect exactly-once semantics have been proven for the current assistant candidates.

Any future document claiming one of these must link new evidence and explicitly supersede this state.

---

## Next research action

Do not restart broad candidate discovery.

Resume the **OpenClaw qualification** from the assistant-base record, focusing on:

1. generic external-side-effect semantics versus channel-message durability;
2. approval/policy model compared with NaIA;
3. memory/privacy and per-agent isolation;
4. safety/trust-boundary assumptions;
5. invasiveness for Nayara;
6. evidence/test maturity;
7. final comparison with OpenMausBot and NaIA.

Only after that block is closed should an assistant-base recommendation be made.
