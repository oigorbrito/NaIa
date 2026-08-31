# Qualified Chassis Gate V1

Status: RESEARCH / NO WINNER SELECTED
Date baseline: 2026-08-31
Repository: tihotm/NaIa

## Objective

Select a durable execution chassis for NaIa using reproducible evidence instead of popularity, README claims, or architecture preference.

The selected chassis must support long-running personal/family assistant goals that may span minutes, hours, or days, survive failures, preserve authority, and avoid silently duplicating or losing external actions.

## Evidence hierarchy

Decision weight is ordered as follows:

1. Standards / regulators / recognized technical guidance.
2. Independent empirical work and reproducible external benchmarks.
3. Upstream integration, fault-injection, Jepsen, chaos, replay, and compatibility tests.
4. Source-code inspection of the mechanism that implements the claimed property.
5. Recent CI evidence on the exact tested branch/commit.
6. Open/closed defect evidence and maintainer diagnosis.
7. Project documentation.
8. README, stars, marketing, community popularity: discovery only.

A README claim is not accepted as proof when source or tests can verify the property.

## Quality and security baseline

Reference families used by the project include:

- ISO/IEC 25010:2023 — product quality model.
- ISO/IEC/IEEE 29119 — software testing processes/documentation/design techniques.
- NIST SP 800-218 SSDF and SP 800-218A — secure software and generative-AI development practices.
- NIST AI RMF / AI 600-1 — AI risk management.
- OWASP GenAI / Agentic guidance — agent surfaces such as tools, memory, identity, human oversight and multi-agent interactions.
- OpenSSF Scorecard and SLSA — OSS/supply-chain signals and provenance.

These references are not treated as product certifications.

## Candidate gate

Every chassis is evaluated on the same dimensions:

- License and commercial-use constraints.
- Active maintenance and release history.
- Security policy and vulnerability history.
- Reproducible build/provenance signals when available.
- Crash/restart recovery.
- Durable timers and waits.
- Human-in-the-loop survival across restart.
- Stale-worker / stale-attempt fencing.
- Concurrent recovery ownership.
- Duplicate delivery handling.
- Cancellation semantics.
- Dependency/storage failure behavior.
- Replay/version compatibility.
- Long-history behavior.
- External side-effect ambiguity.
- Observability of degraded/dead states.
- Operational surface for single-node and HA deployments.

## Decision rules

### Critical failure

A candidate is RED for a tested configuration when evidence demonstrates one of:

- silent work loss;
- recovery resumes the wrong semantic operation;
- stale attempt can overwrite a newer valid attempt;
- a dead execution remains reported healthy without self-heal;
- configuration silently disables durability/security;
- replay/recovery behavior varies nondeterministically under a supported configuration and can duplicate effects.

### Conditional qualification

A candidate may remain qualified with explicit constraints when the defect is configuration-specific and a verifiable fail-closed mitigation exists, e.g. runtime pinning, forbidden APIs, mandatory timeouts, replay-history CI.

### External effect rule

No engine receives `EXACTLY_ONCE_EXTERNAL = PASS` merely because its workflow replay is deterministic.

External actions are classified as:

- A — same transactional/durable protocol as engine state;
- B — engine-mediated idempotency/reconciliation;
- C — application/provider idempotency required.

A payment, message, reservation, email or external API call in category C must carry a stable operation identity and have a reconciliation strategy.

## Required evidence record

For each candidate and property:

- candidate + version/commit;
- claim;
- source-code path and mechanism;
- upstream test path;
- recent CI run when available;
- known issues affecting the property;
- external benchmark/test, if any;
- local reproduction status;
- verdict: PASS / PARTIAL / FAIL / BLOCKED / INCONCLUSIVE;
- admissible and forbidden configurations.

## Current process state

WINNER = NOT_SELECTED
BENCHMARK_TO_BEAT = NOT_SELECTED
LOCAL_COMMON_HARNESS = SPECIFIED, NOT YET EXECUTED

A winner may only be selected after:

1. finalists run the common T1–T16 fault suite locally or in a controlled CI environment;
2. critical failures are resolved, excluded by configuration, or explicitly accepted;
3. a deliberate GitHub challenger search is performed against the resulting benchmark;
4. license/lock-in and operational cost are included in the final decision.
