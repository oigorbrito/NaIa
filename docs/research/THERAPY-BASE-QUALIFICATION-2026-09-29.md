# Therapy Base Qualification — 2026-09-29

Status: **ACTIVE RESEARCH RECORD**

This document records the evidence-first qualification of complete therapeutic-system candidates for Nayara.

It does **not** select a production-ready clinical system. It distinguishes:

```text
THERAPEUTIC QUALITY
!= PRODUCT READINESS
!= SAFETY QUALIFICATION
!= LICENSE CLEARANCE
```

---

## Target

Nayara Therapist is intended to be a separate bounded context from the personal assistant.

The desired base should already contain expensive therapeutic capabilities such as:

- multi-session continuity;
- longitudinal memory;
- session-level planning;
- therapy-specific skills;
- adaptation across sessions;
- resistance/evasiveness handling;
- model/checkpoint reuse potential;
- empirical evaluation;
- a code structure that can receive stronger safety, privacy, and deployment layers without rewriting the therapeutic core.

Assistant tools, shopping, arbitrary browsing, email, calendar, and computer-use are outside this domain.

---

## Evidence protocol

External evidence is used first.

Local testing is reserved for material Nayara-specific deltas, especially:

- Portuguese transfer;
- reserved/evasive client robustness by subgroup;
- crisis/safety layer;
- memory isolation;
- production authentication/privacy;
- licensing;
- integration with Nayara's handoff boundary.

Primary sources inspected:

- PsychAgent repository and released code;
- PsychAgent model card;
- PsychEval benchmark and ACL 2026 publication;
- TheraMind repository and WWW 2026 release;
- PsyLLM repository as a third-candidate scan;
- project evidence requirements derived from AgentMental and PATIENT-Ψ.

---

# Candidate A — PsychAgent

Repository:

`ECNU-ICALK/PsychAgent`

Inspected revision:

`469f45ef468b968b3fccd1936d7e6a0a574e4c5c`

## Expensive capabilities already present

### Multi-session system

The released system contains:

- course/session state;
- session summaries;
- evolving client profile;
- next-session focus;
- homework carry-over;
- stage progression;
- multi-session resume paths.

The sample runner reconstructs session history and next-session state instead of starting from zero.

### Memory-Augmented Planning

The released model card describes MAPE:

```text
evolving client profile
+ session summaries
+ session-level planning
= longitudinal continuity
```

The public Web implementation stores per-visit psychological context and carries forward relevant session summaries, goals, homework, profile information, and next-session focus.

### Skill retrieval

The public repository includes a hierarchical skill library across therapy schools and stages.

Runtime behavior includes:

1. coarse skill filtering;
2. query rewriting using session goal + dialogue history;
3. embedding retrieval;
4. top-k skill selection;
5. prompt injection of selected therapeutic skills.

### Resistance / avoidance / defensive behavior

Repository evidence includes skills and triggers for:

- resistance;
- avoidance;
- silence;
- defensive behavior;
- reluctance to disclose;
- privacy-related resistance;
- gradual exploration instead of immediate confrontation.

The skill-rewrite prompt explicitly evaluates whether the client understood, resisted, or deviated from the previous intervention.

This provides **mechanism evidence**, but not a published PATIENT-Ψ `reserved` subgroup score.

### Reward-guided trajectory selection

The public release includes best-of-n rollout and reward-driven selection.

The model card reports rollout number `N=8` in the training procedure.

### Multi-therapy coverage

The release contains prompts/skills for:

- Behavior Therapy;
- CBT;
- Humanistic-Existential Therapy;
- Psychodynamic Therapy;
- Postmodernist Therapy.

### Runnable product surface

Unlike a paper-only release, PsychAgent currently includes a browser workspace with:

- registration/login;
- creation of counseling courses;
- therapy-school selection;
- multiple visits;
- persistent local database;
- session close and continuation.

This makes it more than a static model checkpoint, although the Web layer is explicitly lightweight/demo-oriented.

---

## External empirical evidence

### PsychEval

PsychEval is a Findings of ACL 2026 benchmark for:

- 6–10 sessions per case;
- multi-therapy counseling;
- memory continuity;
- dynamic goal tracking;
- longitudinal planning;
- 677 meta-skills;
- 4,577 atomic skills;
- 18 shared/specific counselor/client metrics;
- more than 2,000 diverse client profiles.

### PsychAgent results

The public PsychAgent model card reports:

| Dimension | PsychAgent 32B |
|---|---:|
| Counselor Shared | 7.32 |
| Counselor Specific | 7.91 |
| Client Shared | 5.92 |
| Client Specific | 8.24 |

The same table reports TheraMind at:

| Dimension | TheraMind |
|---|---:|
| Counselor Shared | 6.25 |
| Counselor Specific | 6.94 |
| Client Shared | 5.48 |
| Client Specific | 7.83 |

The authors also report a matched human evaluation over 522 multi-session dialogues, with two human annotators plus a Gemini-3 auxiliary rater across:

- Ethics;
- Interaction;
- Intervention;
- Perception.

Human-human QWK is reported as `0.675`.

Important limitation:

```text
PUBLISHED AGGREGATE ADVANTAGE
!=
PATIENT-Ψ RESERVED-SUBGROUP PROOF
```

---

## Product/chassis defects found

### Authentication is demo-grade

The current Web backend hashes passwords with direct SHA-256:

`hashlib.sha256(password.encode("utf-8")).hexdigest()`

This is not an appropriate production password-storage design.

Other current Web concerns include:

- CORS `*`;
- simple bearer-token records;
- no token expiry visible in the inspected model;
- local SQLite default;
- no production privacy/governance boundary.

These are product-layer defects and appear replaceable without rewriting the therapeutic core.

### Safety is not a subsystem

Repository searches found no explicit crisis/suicide/escalation subsystem.

The model card explicitly says the released model should not be relied on for:

- emergencies;
- crisis intervention;
- suicide-risk handling;
- other high-stakes clinical scenarios.

For Nayara this is a major missing layer.

Required architecture:

```text
INPUT
  ↓
THERAPY SAFETY GATE
  ↓
THERAPEUTIC ENGINE
  ↓
OUTPUT SAFETY / ESCALATION
```

Safety must not be implemented as prompt-only behavior.

### Public release is incomplete versus paper-scale system

The repository explicitly states that it does not include:

- full PsychEval paper-scale training/evaluation assets;
- complete post-session skill extraction/evolution pipeline;
- complete end-to-end post-training recipe.

Therefore:

```text
PAPER SYSTEM
!=
PUBLIC REPOSITORY SNAPSHOT
```

### License is unresolved

The repository says it does not contain a repository license file.

The Hugging Face checkpoint currently reports:

`License: other`

No product/commercial clearance should be inferred.

This is an **adoption blocker**, not a technical-performance failure.

---

## Architectural repairability

Observed core layering is favorable enough for further qualification:

```text
web/product surface
      ↓
PsychAgentWebBackend
      ↓
prompt manager
skill manager
model backend
      ↓
model service
```

Therapy state is represented separately through course/visit/context records.

This suggests that authentication, storage, safety, and handoff boundaries can be replaced/added without necessarily rewriting the skill/memory/planning core.

Classification:

`REPAIRABILITY = MODERATE_TO_GOOD`

---

## PsychAgent local tests still justified

Do **not** rerun PsychEval merely to obtain another aggregate number.

The material Nayara deltas are:

### T-PA-1 — Portuguese transfer

Verify preservation of:

- therapeutic role;
- skill-selection quality;
- longitudinal continuity;
- strategy consistency.

### T-PA-2 — Reserved/evasive subgroup

Use PATIENT-Ψ-style behavior or an equivalent controlled simulator.

Required slices:

- cooperative;
- reserved/evasive;
- upset/resistant;
- verbose;
- tangential;
- pleasing/approval-seeking.

Measure degradation by subgroup, not only aggregate average.

### T-PA-3 — Information-gap behavior

Test whether the system:

- detects insufficient information;
- asks targeted follow-up;
- avoids premature formulation;
- maintains uncertainty when evidence is incomplete.

AgentMental is a mechanism reference for this test.

### T-PA-4 — Role-boundary adversarial test

Examples:

- price search;
- shopping;
- recipe;
- email;
- calendar;
- arbitrary calculation;
- computer control.

Expected:

```text
NO PERSONAL TOOL EXECUTION
THERAPEUTIC ROLE MAINTAINED
OPTIONAL MINIMAL HANDOFF OFFER
```

### T-PA-5 — Crisis/safety integration

PsychAgent itself is not qualified for this.

The test applies only after a separate safety/escalation layer is integrated.

Use MHSafeEval and CounselBench adversarial cases as external qualification sources where applicable.

### T-PA-6 — Memory isolation

Verify that therapy memory:

- cannot be queried by personal assistant;
- cannot leak through handoff;
- is encrypted/governed separately;
- is not silently promoted into general profile memory.

---

## PsychAgent status

```text
THERAPEUTIC_ENGINE_FIT      = STRONG
LONGITUDINAL_FIT           = STRONG
SKILL_ARCHITECTURE_FIT     = STRONG
RESISTANCE_MECHANISMS      = PRESENT
PUBLIC_PRODUCT_MATURITY    = PARTIAL
SAFETY_RUNTIME             = NOT_QUALIFIED
LICENSE                    = BLOCKED / UNCLEAR
PRODUCTION_AUTH            = NOT_QUALIFIED
LOCAL_SUBGROUP_TEST        = REQUIRED
```

Current disposition:

`TECHNICAL_LEAD / ADOPTION_HOLD`

---

# Candidate B — TheraMind

Repository:

`Emo-gml/TheraMind`

Inspected revision:

`416d0a00ecc8c76229512197765dc95be6513de5`

## Expensive capabilities already present

TheraMind's strongest contribution is its dual-loop idea:

```text
TURN LEVEL
emotion
reaction/resistance
response strategy
        ↓
SESSION LEVEL
therapy choice
cross-session evaluation
treatment stage
therapy adaptation
```

The public `TherapistEvaluator` includes:

- client reaction/resistance evaluation;
- emotion assessment;
- response-strategy selection;
- therapy-effect evaluation;
- therapy switching across sessions;
- treatment-stage analysis;
- selective use of historical memory.

This is directly relevant to Nayara.

---

## Evidence relevant to evasive/resistant interaction

TheraMind has an explicit per-turn check for whether the patient:

- rejects the topic/advice;
- shows impatience;
- refuses to continue;
- significantly deviates from the consultation topic.

Its strategy selector then uses a positive/negative classification and selects a response strategy.

This is a useful mechanism donor for Nayara's resistant/evasive-client handling.

However, the included PatientAgent simplifies attitude into a random:

`positive / negative`

with approximately `70/30` weighting.

That is materially weaker than a dedicated PATIENT-Ψ-style communication-style taxonomy.

---

## Chassis defects found

### File-based memory

`StrictMemoryManager` writes patient records and session dialogues directly into JSON files under local directories.

No production-grade evidence was found for:

- transactional persistence;
- concurrent writes;
- encryption;
- per-user authorization;
- isolation;
- retention policy;
- schema migration discipline.

### Concrete state-access inconsistencies

The memory structure stores sessions under:

`data["sessions"]["session_N"]`

but some helper functions inspect:

`data["session_N"]`

at the root level.

Examples include session-access/update helpers in the inspected public implementation.

This is a direct code-quality/state-consistency concern.

### Provider/model coupling

Although API configuration is loaded, multiple execution paths hard-code:

`Pro/deepseek-ai/DeepSeek-V3`

This weakens model replaceability.

### No production product surface

The repository is primarily:

- evaluation code;
- dataset preparation;
- patient simulation;
- automatic conversation simulation;
- research agent code.

It is not a persistent end-user therapeutic product comparable to the PsychAgent Web workspace.

### Safety subsystem absent

No explicit crisis/suicide/escalation safety subsystem was found in inspected source searches.

### License blocks direct product adoption

README license:

`For research and educational use only.`

For a product path, separate permission/license would be required.

---

## External comparative signal

In the PsychAgent model card's PsychEval comparison, TheraMind is below PsychAgent on all four reported aggregate dimensions.

This is a useful comparative signal because both are evaluated in the same benchmark table.

It does not mean every TheraMind mechanism is inferior.

In particular, its explicit turn-level reaction/strategy pipeline is architecturally useful as a donor.

---

## TheraMind status

```text
THERAPEUTIC_ENGINE_FIT      = INTERESTING
ADAPTIVE_STRATEGY           = STRONG_PATTERN
RESISTANCE_MECHANISM        = EXPLICIT
LONGITUDINAL_PATTERN        = PRESENT
PRODUCT_MATURITY            = LOW / RESEARCH
MEMORY_CHASSIS              = WEAK
MODEL_REPLACEABILITY        = WEAK_IN_PUBLIC_CODE
SAFETY_RUNTIME              = NOT_QUALIFIED
LICENSE                     = PRODUCT_BLOCKER
```

Current disposition:

`DONOR / NOT_PREFERRED_AS_BASE`

---

# Third-candidate scan

## PsyLLM

PsyLLM combines diagnostic and therapeutic reasoning and has an open model/data release.

However:

- it is primarily a model/research release rather than a longitudinal product chassis;
- its public license is research/educational only;
- in the current PsychEval comparison published with PsychAgent, its aggregate results do not displace PsychAgent as the current technical lead for this target.

Disposition:

`MODEL/DATA DONOR — NOT CURRENT BASE LEAD`

## AgentMental

AgentMental is relevant for:

- information-gap detection;
- adaptive follow-up;
- uncertainty reduction.

Disposition:

`MECHANISM DONOR`

## PATIENT-Ψ

PATIENT-Ψ is relevant for:

- controlled patient communication styles;
- especially reserved/evasive behavior.

Disposition:

`EVALUATION/SIMULATION DONOR`

---

# Current engineering decision

Do not merge PsychAgent and TheraMind repositories.

Current evidence supports:

```text
NAYARA THERAPIST
      ↓
PsychAgent-like base
      +
TheraMind turn-level adaptation patterns
      +
AgentMental information-gap mechanism
      +
PATIENT-Ψ subgroup testing
      +
PsychEval longitudinal qualification
      +
CounselBench / MHSafeEval safety-quality gates
      +
Nayara-owned safety/privacy/isolation boundary
```

This is a **composition of proven mechanisms around one base**, not a source-code merge of multiple research projects.

---

# Decision state

```text
THERAPY_BASE_TECHNICAL_LEAD = PSYCHAGENT
THERAPY_BASE_SELECTED       = NO
ADOPTION_STATUS             = HOLD
```

Reasons for HOLD:

1. repository license unresolved;
2. model checkpoint license unresolved (`other`);
3. crisis/safety runtime absent;
4. production privacy/authentication not qualified;
5. reserved/evasive subgroup performance not separately demonstrated;
6. Portuguese transfer not demonstrated.

---

# Next evidence block

Before any large implementation:

1. clarify PsychAgent repository/checkpoint license;
2. build a minimal Nayara adapter around the therapeutic core rather than the demo auth/UI;
3. run only the material local deltas:
   - Portuguese;
   - evasive/resistant subgroup;
   - information-gap behavior;
   - role-boundary adversarial cases;
   - memory isolation;
4. integrate a separate safety gate before evaluating crisis behavior;
5. do not transplant personal-assistant tools into the therapist runtime.

