# NaIa Project Plan Baseline

Date: 2026-08-31
Status: RESEARCH / PRE-IMPLEMENTATION

## Current product thesis

NaIa is being explored as an operational personal/family AI assistant rather than a chat-only assistant.

Target control flow:

`intent -> objective -> plan -> policy/authorization -> tools -> execution -> evidence -> verification -> monitoring/recovery`

Product principles under research:

- resolve real tasks, not only answer questions;
- return user time rather than maximize attention;
- persistent goals rather than one-shot prompts;
- evidence for real-world actions;
- graduated autonomy based on risk;
- fail closed for sensitive ambiguity;
- personal/family context with explicit privacy boundaries;
- child/teen capabilities must have age-appropriate safety and legal requirements.

## Engineering method

Rules are engineering guardrails, not dogma.

- Prefer qualified existing components over reinventing commodity infrastructure.
- Challenge user/project preferences when stronger evidence supports another direction.
- Distinguish standards, independent empirical evidence, upstream tests, source inspection and vendor claims.
- Reproduce important external tests locally before final qualification.
- Record blockers as blockers; never convert unavailable evidence into PASS.
- Record rejected alternatives and why they were rejected.

## Work blocks

### Block 1 — Qualified chassis

Goal: select the durable execution foundation.

State: IN PROGRESS.

Current survivors: Temporal TS restricted profile, DBOS TS, Restate, Trigger.dev; Cadence/Azure Durable remain research controls.

Exit criteria:

- common T1–T16 suite implemented;
- finalist configurations executed under equivalent conditions;
- critical reliability mutants resolved;
- license/lock-in/operational surface compared;
- deliberate GitHub challenger search performed after a benchmark-to-beat exists.

### Block 2 — Reference architecture

Goal: define boundaries after chassis evidence exists.

Expected concerns, not yet frozen:

- durable execution;
- agent/reasoning layer;
- policy/autonomy/budget;
- identity/household roles;
- memory/context;
- tool registry/capability ladder;
- channels such as WhatsApp/voice/web;
- evidence and independent verification;
- monitoring/recovery;
- secrets and data protection.

State: NOT STARTED formally.

### Block 3 — Capability evidence matrix

Goal: map user-facing functions to evidence, reusable OSS, risk and tests.

Capability families already identified:

- Goal Keeper;
- Life Inbox;
- memory and context graph;
- reminders/scheduling;
- attention firewall;
- guardian/anti-scam;
- negotiation/business contact;
- bureaucracy agent;
- personal finance monitoring;
- family/household coordination;
- child/teen modes and progressive autonomy;
- voice;
- research with citations/evidence;
- browser/computer-use fallback;
- plan-B/recovery;
- execution receipts.

State: CONCEPTUAL, NOT QUALIFIED.

### Block 4 — Empirical capability validation

Candidate external suites include BFCL, tau-bench/tau2-bench, LongMemEval, AgentDojo, WorkArena/BrowserGym, OSWorld and GAIA where applicable.

State: RESEARCH IDENTIFIED, NOT REPLICATED.

### Block 5 — MVP implementation

Scope must be chosen only after Blocks 1–3 provide evidence.

State: NOT STARTED.

### Block 6 — Operational fault model and release qualification

NaIa must have its own fault model covering at minimum filesystem, paths, links, process/shell, configuration/environment, secrets, provider/network, staging, acceptance, promotion, evidence, concurrency and resource exhaustion.

State: NOT STARTED.

## Progress model

Percentages are engineering estimates, not earned-value accounting.

| Area | Current estimate |
|---|---:|
| Product thesis/differentiation | 80% |
| Competitive assistant benchmark | 80% |
| Capability discovery | 70% |
| Durable chassis research | 72% |
| License/lock-in review of chassis | 65% |
| Chassis fault model specification | 75% |
| Common local chassis harness implementation | 5% |
| Formal reference architecture | 30% |
| OSS component map beyond chassis | 35% |
| Versioned project documentation | 20% after this research branch |
| MVP implementation | 0% |
| Integrated security/autonomy controls | 0% |
| NaIa operational fault injection | 0% |
| Release qualification | 0% |

Project-to-verifiable-MVP estimate: approximately 18%.

Plan maturity estimate: approximately 62%.

These numbers must be revised when executable evidence replaces research assumptions.

## Current decision status

CHASSIS_WINNER = NOT_SELECTED
BENCHMARK_TO_BEAT = NOT_SELECTED
REFERENCE_ARCHITECTURE = NOT_FROZEN
MVP_SCOPE = NOT_FROZEN

The immediate next objective is to implement and execute the common T1–T16 chassis harness before selecting a winner.
