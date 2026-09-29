# Assistant Base Qualification — 2026-09-29

Status: **IN PROGRESS — NO WINNER SELECTED**

Purpose: compare complete, functioning assistant systems as possible bases for Nayara, while treating frameworks and durable runtimes as components/donors rather than pretending they are equivalent product candidates.

## Selection principle

The question is not:

> Which repository has the cleanest architecture or the largest feature list?

The question is:

> Which functioning system reaches the target Nayara architecture with the least invasive repair while preserving the largest amount of proven product capability?

Important distinction:

```text
FEATURE_RICH != GOOD_CHASSIS
PERSISTENT != DURABLE
COMPONENT != COMPLETE_PRODUCT_BASE
```

The key classification for each gap is:

```text
LOCALIZED_REPAIR
vs
CROSS_CUTTING_STRUCTURAL_REWRITE
```

---

# Target properties

Expensive properties preferred in the base:

- persistent assistant identity;
- conversation/session persistence;
- routines and unattended background work;
- multi-provider/model replaceability;
- desktop/mobile/product surfaces;
- messaging and app integrations;
- browser/computer interaction;
- restart/recovery behavior;
- stable operation identity;
- stale-worker/stale-response rejection;
- auditable authorization/approval;
- durable outbound handling;
- strong test/verification surface;
- license suitable for intended product use.

Nayara-specific authority requirements may still need to be added.

The therapeutic system is outside this candidate comparison and remains a separate bounded context.

---

# Candidate A — OpenMausBot

Repository:

`milind-soni/OpenMausBot`

Qualified snapshot:

`947bef311bf5c3f55d3590849abf0eb329408519`

Package version observed during qualification:

`0.1.91`

Current disposition:

`STRONG_BASE / REQUIRES_AUTHORITY_AND_DURABILITY_REINFORCEMENT`

## Expensive capabilities already present

Evidence from the inspected repository showed a functioning product surface including:

- persistent bots;
- persistent transcripts/messages;
- routines/scheduling;
- queued message behavior;
- persistent delegations;
- desktop/Electron;
- mobile companion work;
- browser/computer-use;
- connected-app integrations;
- multiple model/driver providers;
- session model switching;
- memory files and journal behavior;
- permission broker;
- SSE/event-bus/harness architecture;
- deterministic eval infrastructure.

The repository also exposes clear insertion boundaries such as driver registries, harness/server layers, message storage, routines, and delegation services.

This makes OpenMausBot materially different from a framework-only candidate.

## Engineering maturity signal

At the inspected snapshot, repository inventory showed approximately:

- 793 test/spec files;
- 420 under `server/`;
- 74 under `electron/`;
- 248 files under `docs/verification/`.

These counts are **not a quality score**. They are evidence that a large operational surface is exercised and documented.

## Persistence evidence

Observed mechanisms include:

- bot/message persistence across restart;
- SQLite transcript/message storage;
- routine persistence;
- deferred routine timestamp surviving restart;
- normalized routine requests persisted so a confirmation need not be reinterpreted by a model after restart;
- delegation persistence;
- stable IDs for messaging/routine flows.

This is valuable product persistence.

It is not automatically proof of generic external-effect durability.

## Stale-turn / stale-response behavior

The inspected code includes generation/turn identity handling and explicit rejection/quarantine of events from obsolete or cancelled executions.

This aligns with Nayara's invariant that stale work must not regain authority.

## Security revalidation

A previously identified shared-computer argument-validation issue was addressed upstream and the follow-up security PR #2023 had been incorporated into `main` when revalidated.

Do not carry the earlier historical HOLD forward as if that specific issue were still open.

The upstream security model still contains documented trust-boundary caveats. Re-check the current `SECURITY.md` before adoption.

## Material gaps

### Provider approval lifetime

Inspected delegation/provider logic documented that provider permissions are process-local and die with the process.

For Nayara, authority should be recoverable/revocable according to explicit persisted semantics rather than silently disappearing or being inferred again.

### Generic external-effect durability

Stable IDs and routine/message dedupe exist, but the qualification did not establish a universal contract equivalent to:

```text
effect applied externally
+ process dies before local commit
+ recovery reconciles without unsafe duplicate
```

Do not promote OpenMausBot as a generic durable side-effect authority based only on persistence.

### Active turn recovery

Compared with OpenClaw evidence found later, OpenMausBot did not demonstrate the same level of automatic interrupted-turn recovery across gateway/process restart.

This is a meaningful structural difference.

### Memory domain suitability

OpenMausBot's personal-assistant memory is useful, but global/shared profile concepts are not an acceptable place for therapeutic memory.

Therapy must remain separately authorized.

## Repairability assessment

Most product-surface gaps appear more localized than rebuilding the product from NaIA.

The difficult remaining work is concentrated around:

- authority semantics;
- persisted approval semantics;
- generic external-effect reconciliation;
- any required durable execution layer;
- Nayara-specific sensitive-memory boundaries.

Current status:

```text
PRODUCT_MATURITY          = STRONG
PERSISTENT_ASSISTANT_FIT  = STRONG
MODEL_REPLACEABILITY      = STRONG
TEST_SURFACE              = STRONG
STALE_EXECUTION_DEFENSE   = PRESENT
GENERIC_EFFECT_DURABILITY = NOT_PROVEN
NAYARA_AUTHORITY_MODEL    = NEEDS_REINFORCEMENT
WINNER                    = NO
```

---

# Candidate B — NaIA

Repository:

`oigorbrito/NaIa`

Qualified main snapshot:

`23e4ca55abfaf399844047792018a22415ed3738`

Current disposition:

`ARCHITECTURAL_DONOR / HIGHER_PRODUCT_BUILD_COST`

## Strong architectural properties

NaIA has explicit product concepts for:

```text
intent
→ objective
→ plan
→ policy
→ approval
→ execution
→ evidence
→ persisted state/resume
```

Observed strengths include:

- independent product ports;
- fail-closed policy;
- risk classification;
- non-read-only approval requirements;
- risk mismatch denial;
- objective and plan persistence;
- evidence log;
- resume that skips completed work;
- runtime capability registration;
- provider-neutral model registry/router;
- personal memory scoped by user;
- sensitive-memory consent checks;
- stable operation/idempotency concepts in multiple subsystems.

These are strong donor contracts for Nayara.

## Approval/evidence advantage

Compared with OpenMausBot, NaIA expresses authority more explicitly in the application architecture.

This makes it a useful source for:

- approval contracts;
- policy boundaries;
- operation identity;
- evidence/audit;
- memory authorization;
- provider neutrality.

## Product integration gap

The current repository contains many product modules, but the inspected `server.mjs` composes only a subset.

Capabilities such as messaging, automations, personal memory, web execution, and provider routing exist as modules but are not all integrated into one mature end-user runtime.

The server path inspected also exposed a relatively thin production shell compared with OpenMausBot/OpenClaw.

Therefore the cost to obtain a complete everyday assistant is not merely repair work; substantial product integration remains.

## Authentication/exposure concern

The inspected server binds to `0.0.0.0`, and no equivalent mature authentication boundary was visible in that primary path.

This is not a claim that authentication cannot be added. It is a product-readiness gap in the inspected snapshot.

## External-effect idempotency caveat

In the messaging path, local dedupe checks occur before send and the successful send record is persisted after `provider.send()`.

That leaves the classic ambiguity window:

```text
provider applies external effect
↓
process fails before local success record
↓
retry cannot know from local state alone whether to repeat
```

This means NaIA's idempotency contracts are useful but do not themselves establish exactly-once external effects.

The durable-execution research in this repository already recognizes this class of failure.

## Current assessment

```text
POLICY/AUTHORITY MODEL     = STRONG
EVIDENCE MODEL             = STRONG
MEMORY AUTHORIZATION       = STRONG
PRODUCT SURFACE            = PARTIAL
END-USER INTEGRATION       = LOWER MATURITY
GENERIC EFFECT DURABILITY  = NOT_PROVEN
BUILD COST TO NAYARA       = HIGHER THAN PRODUCT-RICH BASES
```

NaIA should currently be treated as an architectural donor unless new evidence changes the product-base comparison.

---

# Candidate C — OpenClaw

Repository:

`openclaw/openclaw`

HEAD observed when qualification began:

`df97da27f07f6655d5678bdbf1f6f9e460678013`

Package version observed:

`2026.9.6`

License observed:

`MIT`

Current disposition:

`STRONG_CANDIDATE / QUALIFICATION_IN_PROGRESS`

**Do not interpret the findings below as final selection.**

## Product surface

The inspected project is a complete persistent assistant platform with:

- local Gateway/control plane;
- Control UI;
- CLI/TUI;
- multiple chat channels;
- companion/native platform support;
- voice/device capabilities;
- tools/skills/plugins;
- local and hosted model providers;
- replaceable model/agent harnesses.

This makes it a legitimate product-base candidate.

## Restart recovery evidence

Current documentation inspected at the pinned ref explicitly describes durable storage and recovery for:

- conversation history;
- accepted Control UI follow-ups;
- interrupted main-session turns;
- subagent runs;
- queued outbound deliveries;
- scheduled cron jobs;
- restart continuations.

Per-agent session state uses SQLite.

The documentation says eligible interrupted work is detected and resumed/reconciled after Gateway restart.

This is materially stronger evidence of interrupted-turn recovery than was found in OpenMausBot.

## Stale authority / lineage

The inspected recovery design retains and checks concepts such as:

- original requester session;
- run/turn identity;
- connection identity;
- child/parent lineage;
- requester generation;
- completion ownership;
- cancellation and replacement state.

The documentation explicitly rejects reconstruction of authority solely from later lineage when original ownership is missing.

This aligns strongly with Nayara's stale-worker/stale-response invariants.

## Approval model

OpenClaw host exec approvals are layered over tool policy and allowlists.

Inspected documentation states:

- approval state lives in SQLite;
- host-local policy remains authoritative;
- cancelled/closed turns invalidate pending authority;
- late approval cannot restart cancelled work;
- policy and approval layers can only narrow execution in normal restrictive configurations;
- durable allow/standing-grant concepts exist.

This is stronger persistence/authority evidence than the process-local provider permissions observed in OpenMausBot.

The trust model still needs careful comparison with Nayara's desired user/domain boundaries.

## Outbound delivery durability

OpenClaw exposes a durable outbound lifecycle with concepts such as:

- queued message custody;
- platform-send-started;
- delivered;
- failed;
- unknown/ambiguous delivery;
- persistent delivery queue;
- recovery/retry after restart;
- stable delivery intent;
- idempotency keys/receipts;
- retained evidence intended to prevent unsafe duplicate delivery after ambiguous crashes.

This is highly relevant to the external-effect problem.

However:

```text
DURABLE_CHANNEL_DELIVERY
!=
GENERIC_EXACTLY_ONCE_EXTERNAL_TOOL_EFFECTS
```

The qualification was interrupted before determining how far these semantics generalize to arbitrary connected tools, SaaS writes, purchases, calendar mutations, or other side effects.

That is the most important unresolved OpenClaw question.

## Input/queue caveat

The command queue has both durable input custody and in-process queue behavior depending on stage.

The project documentation explicitly distinguishes input preservation from execution permissions and notes cases where interrupted queued input may require explicit resend.

Do not summarize OpenClaw as "everything is magically durable."

## Trust-boundary caveat

OpenClaw's documented default is a trusted-gateway/personal-operator model. Host exec may be permissive unless tightened with sandbox/tool policy.

For Nayara this must be evaluated against:

- personal assistant isolation;
- therapy separation;
- sensitive-memory authorization;
- multi-user assumptions if any;
- least-privilege defaults.

## Current assessment — provisional

```text
PRODUCT_MATURITY             = STRONG
PERSISTENT_ASSISTANT_FIT     = STRONG
RESTART_RECOVERY             = STRONG_EVIDENCE
STALE_AUTHORITY_DEFENSE      = STRONG_EVIDENCE
OUTBOUND_DELIVERY_DURABILITY = STRONG_EVIDENCE
GENERIC_TOOL_EFFECT_DURABILITY = NOT_YET_QUALIFIED
NAYARA_POLICY_FIT            = NOT_YET_QUALIFIED
MEMORY/DOMAIN_ISOLATION      = NOT_YET_QUALIFIED
WINNER                       = NO
```

---

# Current comparison

This table records status, not a numerical score or winner.

| Property | OpenMausBot | NaIA | OpenClaw |
|---|---|---|---|
| Complete assistant product | Strong | Partial | Strong |
| Persistent identity/state | Strong | Present but less integrated | Strong |
| Interrupted-turn recovery | Not proven at OpenClaw level | Research/contracts stronger than product integration | Strong evidence |
| Background/routines | Strong | Modules present | Strong |
| Multi-provider replaceability | Strong | Strong contract | Strong |
| Explicit policy/approval architecture | Needs reinforcement | Strong | Strong but different trust model |
| Stale execution defense | Present | Targeted contracts/research | Strong evidence |
| Durable outbound messaging | Partial evidence | Idempotency concepts; ambiguity remains | Strong evidence |
| Generic external-effect durability | Not proven | Not proven | Not yet qualified |
| Product integration maturity | Strong | Lower | Strong |
| Therapy-domain isolation | Must be separate | Must be separate | Must be separately designed |
| Final base selected | No | No | No |

---

# Why OpenClaw must be finished before selection

OpenClaw has already demonstrated properties that materially change the earlier OpenMausBot-versus-NaIA framing:

- automatic interrupted-turn recovery;
- persisted approval infrastructure;
- durable outbound queue/receipts;
- strong ownership/generation checks.

Therefore selecting OpenMausBot before closing these questions would be premature.

The next qualification block must answer:

1. Are arbitrary external tool writes protected by a generalized operation/effect protocol, or are the strongest guarantees channel-specific?
2. How do OpenClaw's policy and approval contracts compare with the fail-closed contracts desired by Nayara?
3. Can personal memory be scoped strongly enough while keeping Therapy entirely outside its authority?
4. How invasive would Nayara-specific authority changes be?
5. What security/trust assumptions would have to change?
6. Which remaining local tests are genuinely required after using upstream evidence?

Only after those questions are answered should the assistant base be selected.

---

# Preserved engineering direction

Regardless of the winning product base, useful donor concepts remain:

### From NaIA

- policy/approval boundary;
- risk model;
- evidence records;
- stable semantic operation identity;
- sensitive-memory consent;
- provider-neutral contracts;
- durable-execution fault suite.

### From OpenMausBot

- persistent product UX;
- driver/model switching;
- routines;
- connected-app/product surface;
- deterministic harness/evals;
- product-level verification practices.

### From OpenClaw

Provisional donors already visible:

- restart recovery;
- persisted session/run custody;
- stale-authority lineage checks;
- durable outbound delivery receipts;
- persistent approvals;
- mature gateway/channel/product infrastructure.

Reuse of a donor mechanism is still subject to license, implementation compatibility, and local transfer checks.
