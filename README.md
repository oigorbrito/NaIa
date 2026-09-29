# NaIA

**User-facing AI capability platform for turning intent into governed, resumable actions across local tools and external providers.**

NaIA is the project in this portfolio that sits closest to an **end-user assistant/product surface**.

Its core path is:

```text
user intent
    ↓
normalized interpretation
    ↓
actionable plan
    ↓
tool / provider selection
    ↓
policy + approval
    ↓
execution
    ↓
evidence
    ↓
persisted state / resume / history
```

NaIA is **not** a MetaO-style control plane and it is **not** a CodePro-style experimental chassis.

- MetaO governs orchestrators/runtimes.
- CodePro studies software-agent mechanisms empirically.
- NaIA turns user intent into governed capabilities and product workflows.

---

## Current product surface

The current product line includes:

- persisted objectives and plans;
- append-only execution evidence;
- resumable objectives;
- deterministic and extensible intent planning;
- capability registration;
- explicit risk classes;
- approval before side effects;
- task/history/billing/entitlement surfaces;
- file-backed local state;
- a web/server product surface;
- provider-neutral adapter boundaries.

The local product path can already execute read-only and approved local-write capabilities.

Representative flow:

```text
"note release-plan: ship capability"
        ↓
planner
        ↓
note.write
        ↓
LOCAL_WRITE
        ↓
WAITING_APPROVAL
        ↓
explicit approval
        ↓
write
        ↓
evidence + persisted objective
```

---

## Capability and policy model

Capabilities declare risk explicitly.

Current risk classes include:

```text
READ_ONLY
LOCAL_WRITE
EXTERNAL_WRITE
SENSITIVE
```

The planner cannot silently upgrade risk.

If the planned action and registered capability disagree, the request fails closed.

Ambiguous or incomplete intent also does not become an executable side effect by default.

Interpretation states include:

- `RECOGNIZED`
- `UNRECOGNIZED`
- `AMBIGUOUS`
- `MISSING_PARAMETER`

---

## External-provider adapters

The repository contains provider adapters and validation tooling for several real external systems.

Examples include:

- OpenAI;
- Anthropic / Claude;
- Gemini;
- DeepSeek;
- Gmail;
- Google Drive;
- Google Calendar;
- Google Photos;
- Slack;
- WhatsApp Cloud API;
- Belvo Open Finance.

These states are intentionally kept separate:

```text
ADAPTER_IMPLEMENTED
!= CREDENTIAL_CONFIGURED
!= LIVE_VALIDATED
!= PRODUCTION_READY
```

Some adapters require OAuth, sandbox accounts, provider billing, or explicit external credentials before live validation.

Secrets are not expected in Git, fixtures, screenshots, or persisted execution evidence.

See [docs/LIVE_CREDENTIALS_SETUP.md](docs/LIVE_CREDENTIALS_SETUP.md).

---

## Provider examples

### Gmail

Search/read and approved send can be represented through the same policy boundary.

```text
search/read
  -> READ_ONLY

send
  -> EXTERNAL_WRITE
  -> approval required
```

### Google Photos

The Picker flow is intentionally user-driven.

```text
create Picker session
    ↓
WAITING_USER
    ↓
user selects media
    ↓
resume persisted session
```

NaIA does not claim silent access to a user's full photo library.

### Belvo

The Open Finance integration is currently framed around read-side banking data and sandbox-first validation.

Payment initiation is outside that bounded scope.

---

## Web / server surface

The repository includes a Node.js server entrypoint that composes:

- NaIA product service;
- task service;
- entitlements;
- usage metering;
- billing records;
- history indexing;
- connector surfaces;
- product web UI.

Run:

```bash
npm install
npm run dev
```

Health:

```text
GET /health
GET /_health
```

The current default storage remains local/file-backed unless another adapter is introduced.

That means:

```text
WEB_SERVER_EXISTS
!= DISTRIBUTED_PRODUCTION_DURABILITY
```

---

## CLI product path

```bash
npm test
npm run start:product -- tools
npm run start:product -- pursue "uppercase: hello naia"
npm run start:product -- pursue "note release-plan: ship capability"
npm run start:product -- approve <objectiveId> note.write
npm run start:product -- show <objectiveId>
npm run start:product -- resume <objectiveId>
npm run start:product -- history
```

---

## Product architecture

```text
Intent layer
    ↓
Planner
    ↓
Capability registry
    ↓
Policy / approval
    ↓
Tool / provider adapter
    ↓
Execution result
    ↓
Evidence
    ↓
Objective state / history
```

The product domain depends on replaceable ports rather than hard-coding one durable execution framework.

This is deliberate: runtime/chassis research can later supply an adapter without rewriting product intent, policy, evidence, or objective semantics.

---

## Evidence-first engineering preflight

Before new architecture research or implementation, read:

- [Evidence-First Engineering](docs/research/EVIDENCE-FIRST-ENGINEERING.md)
- [AGENTS.md](AGENTS.md)

Project rule:

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

Do not repeat a benchmark merely to obtain a local number when high-quality external evidence already answers the same question under materially equivalent conditions.

Always record the source, protocol/task, population, metric, limitations, Nayara-specific delta, and whether a local test is actually required.

For therapeutic research, aggregate quality is insufficient by itself. Preserve subgroup evidence such as cooperative vs reserved/evasive users, single-session vs longitudinal interaction, and ordinary vs safety-critical behavior.

---

## Research track

NaIA also contains a separate research track under:

- `research/chassis/`
- `docs/research/`

That track evaluates durable-execution/chassis options.

It does **not** automatically authorize a chassis migration.

Current decision state:

```text
PRODUCT_FOUNDATION_V1      = COMPLETE
FIRST_USEFUL_CAPABILITY_V1 = COMPLETE
CHASSIS_WINNER             = NOT_SELECTED
BENCHMARK_TO_BEAT          = NOT_SELECTED
DURABLE_EXECUTION_ADAPTER  = NOT_SELECTED
```

Product work is allowed to continue without pretending the research question is already settled.

---

## Engineering rules

```text
INTENT != AUTHORIZATION
TOOL_AVAILABLE != TOOL_AUTHORIZED
ADAPTER_PRESENT != LIVE_VALIDATED
EXECUTED != ACCEPTED
AMBIGUOUS != EXECUTABLE_SIDE_EFFECT
```

The project is designed so user-facing capability can grow without letting provider-specific APIs become product authority.

---

## Start here

- [Product Foundation V1](docs/product/PRODUCT-FOUNDATION-V1.md)
- [First Useful Capability V1](docs/product/FIRST-USEFUL-CAPABILITY-V1.md)
- [Live credentials and validation](docs/LIVE_CREDENTIALS_SETUP.md)
- [AGENTS.md](AGENTS.md)

