# Evidence-First Engineering

Status: **ACTIVE PROJECT METHOD**

This document defines how NaIA/Nayara should research, select, adapt, and validate architecture and domain mechanisms.

The objective is to avoid opinion-driven engineering and unnecessary local re-testing when high-quality external evidence already exists.

---

## Core rule

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

Do not begin from:

> "Which design seems best?"

Begin from:

> "What has already been demonstrated, under what protocol, for which population/task, and what is materially different in Nayara?"

---

## Evidence hierarchy

Use the strongest available evidence first.

| Grade | Evidence | Typical use |
|---|---|---|
| A | Peer-reviewed study + defined benchmark/protocol + accessible data/code/artifacts | Primary design evidence |
| B | Independent reproducible benchmark with disclosed methodology | Comparative evidence |
| C | Upstream benchmark maintained by the project with raw/reproducible artifacts | Candidate-specific evidence |
| D | Upstream source code + deterministic tests demonstrating a mechanism | Mechanism evidence |
| E | Documentation / README / issue / PR / stars / popularity | Discovery and implementation context only |

Lower-grade evidence does not override stronger contradictory evidence.

Popularity, stars, PR count, marketing claims, and README statements are **not architectural qualification**.

---

## Source routing

Use the source that matches the question.

### Repository / implementation mechanism

Prefer the exact upstream Git repository, pinned revision, tests, issues, PRs, and workflow evidence.

### Software library or framework API

Context7 may be used for current framework/library documentation and code examples.

Context7 is **not** the primary authority for academic benchmarks, clinical research, or repository-level empirical qualification.

### Academic / benchmark claim

Prefer the paper, conference proceedings, benchmark repository, dataset card, and released evaluation artifacts.

### Current product/service behavior

Prefer official current documentation plus exact-version source when available.

---

## Research preflight

Before opening a new research track:

1. Search this repository's existing research and evidence records.
2. Search prior candidate evaluations before repeating them.
3. State the exact property being investigated.
4. Identify existing external evidence for that property.
5. Record the population/task and experimental conditions.
6. Identify the material delta between that evidence and Nayara.
7. Only create a local benchmark if the delta could change the engineering decision.

If no material delta exists, prefer reuse/adaptation over redundant benchmarking.

---

## Transfer gate

External evidence does not automatically become local proof.

```text
BENCHMARK_SIGNAL != LOCAL_PROOF
EXTERNAL_SUCCESS != LOCAL_COMPATIBILITY
IMPLEMENTED != QUALIFIED
QUALIFIED != PROMOTED
```

Before transferring a proven mechanism, check:

- model/version;
- language;
- task definition;
- population/persona distribution;
- single-turn vs multi-turn;
- state/memory assumptions;
- runtime/durability assumptions;
- external side effects;
- privacy/security boundaries;
- licensing;
- hardware/deployment constraints;
- evaluation metric compatibility.

Only test the dimensions that materially differ.

---

## Architecture versus feature

Do not reward feature count when selecting a chassis/system base.

A product with many working features may still have poor architectural boundaries. A clean architecture may still be expensive to turn into a product.

The decision variable is:

```text
TOTAL COST TO TARGET STATE
=
valuable working capability already present
+ cost of repairing hard architectural gaps
+ migration/integration cost
+ operational risk
```

A useful additional measure is **architectural invasiveness**:

- number of core modules touched;
- number of authority boundaries rewritten;
- cross-cutting changes required;
- migration surface;
- regression surface;
- data/state migrations;
- compatibility burden.

Prefer repairing bounded defects over rebuilding already-working product surfaces.

---

## Two-system product principle

The personal assistant and therapeutic system are separate bounded contexts.

```text
PERSONAL ASSISTANT
        │
        │ minimal, explicit handoff
        ▼
   HANDOFF BROKER
        ▲
        │ minimal, explicit handoff
        │
THERAPEUTIC SYSTEM
```

They must not share unrestricted memory, credentials, tools, or execution authority.

A user may experience one Nayara product identity, while the internal systems remain separately authorized.

The handoff broker should transfer only the minimum information required for the requested action, with explicit consent where appropriate.

---

## Therapeutic system: evidence-driven requirements

The therapeutic system must not be selected from average conversational quality alone.

It must be evaluated for robustness across different client interaction styles and across longitudinal sessions.

### Adaptive information-gap questioning

**AgentMental** (AAAI 2026) provides a concrete mechanism:

- a question-generation agent;
- an evaluation agent that judges response adequacy;
- targeted follow-up when information is vague, ambiguous, or incomplete;
- a necessity score used to determine whether deeper questioning is warranted;
- dynamically updated tree-structured memory to reduce redundant questioning.

Source:
- Hu et al., *AgentMental: An Interactive Multi-Agent Framework for Explainable and Adaptive Mental Health Assessment*, AAAI 2026.
- https://ojs.aaai.org/index.php/AAAI/article/view/40365
- Code release referenced by the paper: https://github.com/MindIntLab-HFUT/AgentMental

**Applicability to Nayara:** mechanism donor for adaptive elicitation and uncertainty reduction.

**Do not infer:** that the framework establishes a medical/psychological diagnosis appropriate for Nayara. The relevant transferable mechanism is information-gap management and adaptive questioning.

### Evasive / reserved clients

**PATIENT-Ψ** (EMNLP 2024) defines six conversational styles:

- plain;
- verbose;
- upset;
- reserved;
- tangent;
- pleasing.

The **reserved** style is explicitly characterized by brief, vague, or evasive responses, reluctance to disclose, and a need for additional prompting/encouragement.

Source:
- Wang et al., *PATIENT-Ψ: Using Large Language Models to Simulate Patients for Training Mental Health Professionals*, EMNLP 2024.
- https://aclanthology.org/2024.emnlp-main.711/
- https://github.com/ruiyiw/patient-psi

**Project implication:** a therapeutic candidate that performs well only with cooperative/direct users is not sufficiently qualified. Evaluation must preserve results by interaction-style subgroup rather than report only an aggregate mean.

### Longitudinal therapeutic evaluation

Current project candidates/evaluation assets include:

- **PsychAgent** — longitudinal memory/planning, skill retrieval, reward-guided trajectory selection; research-system/model candidate.
- **TheraMind** — turn-level + session-level dual-loop therapeutic strategy; research architecture candidate.
- **PsychEval** — multi-session, multi-therapy evaluation with memory continuity, dynamic goal tracking, and longitudinal planning.
- **CounselBench** — expert human evaluation plus adversarial counseling cases.
- **MHSafeEval** — adversarial multi-turn mental-health safety evaluation with role-aware harm taxonomy.
- **PsyQA / SoulChat** — training/behavioral-data references subject to their access and license constraints.

These assets occupy different layers. Do not force them into one chassis competition.

---

## Therapeutic uncertainty rule

The system should be able to preserve uncertainty instead of forcing premature conclusions.

```text
evidence collected
      ↓
information sufficient?
   /         \
 no          yes
 ↓            ↓
targeted     update working
follow-up    formulation
 ↓
new evidence
 ↓
re-evaluate
```

Useful states may include:

- supported working hypothesis;
- competing hypothesis;
- insufficient information;
- contradictory evidence;
- requires follow-up;
- requires human/professional escalation.

```text
UNCERTAINTY != FAILURE
```

---

## Evaluation by subgroup

For behavioral systems, always ask whether the reported aggregate hides a failure mode.

Relevant therapeutic slices include:

- cooperative vs reserved/evasive;
- concise vs verbose;
- calm vs upset/resistant;
- focused vs tangential;
- independent vs approval-seeking/pleasing;
- first session vs later sessions;
- single-session vs longitudinal;
- complete vs ambiguous disclosure;
- stable vs contradictory memory;
- ordinary support vs safety-critical interaction.

Do not promote a therapeutic architecture from a single aggregate score if a product-critical subgroup is weak or unreported.

---

## Candidate roles

Do not compare components that solve different layers as if they were direct substitutes.

Examples:

```text
PRODUCT / PERSISTENT ASSISTANT BASE
    OpenMausBot
    NaIA
    other complete product candidates

AGENTIC ORCHESTRATION
    Microsoft Agent Framework
    Deep Agents / LangGraph
    PydanticAI
    Google ADK
    OpenAI Agents SDK

DURABLE EXECUTION
    Temporal
    DBOS
    Restate
    Trigger.dev

MEMORY ENGINE
    NaIA memory authority
    Mem0 retrieval/memory engine

THERAPEUTIC SYSTEM / MODEL
    PsychAgent
    TheraMind
    other complete therapeutic candidates

THERAPY QUALITY / SAFETY EVAL
    PsychEval
    CounselBench
    MHSafeEval
```

---

## Evidence record template

Every material architectural or behavioral decision should record:

```text
PROPERTY:
QUESTION:

SOURCE:
SOURCE TYPE:
VERSION / DATE:
POPULATION / TASK:
PROTOCOL:
METRIC:
REPORTED RESULT:

MECHANISM:
KNOWN LIMITATIONS:

NAYARA DELTA:
LOCAL TEST REQUIRED: YES / NO
WHY:

DECISION:
STATUS:
```

If the source does not disclose enough information to fill the relevant fields, downgrade its evidentiary weight.

---

## Local-test rule

Create a local test when one or more of these are material:

- our model differs;
- our language differs;
- our user population differs;
- our tool/side-effect environment differs;
- our memory semantics differ;
- our safety boundary differs;
- our runtime/restart semantics differ;
- our integration changes the proven mechanism;
- external results are not reproducible or do not expose the relevant subgroup.

Otherwise, do not reproduce a benchmark simply to obtain another number.

---

## Preservation rule

Do not rewrite old evidence to match new conclusions.

New evidence is additive.

```text
OLD RESULT + NEW CONTEXT
!=
RETROACTIVE REINTERPRETATION AS OLD RESULT
```

Pin important evidence to source/version/date whenever practical.
