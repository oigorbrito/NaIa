# OpenManus reverse integration — OM-NAIA-01

## Purpose

Test the inverse architecture for the NaIA pocket-secretary product:

```text
OpenManus = host/runtime/capability layer
NaIA      = authority/product semantics layer
```

The experiment asks whether OpenManus can host browser/computer capabilities while NaIA remains authoritative for policy, approval, idempotency/evidence boundaries, and product semantics.

## Frozen inputs

- NaIA empirical baseline: `product/mvp-foundation-v1`
- NaIA baseline commit: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- OpenManus pinned commit: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Prior minimal execution experiment: `CANDIDATE_ACCEPTED`

## Architecture under test

```text
user intent
   |
   v
OpenManus host / browser capability
   |
   | proposes action(name,args,risk)
   v
NaIA authority gateway
   |
   +-- DENY / REQUIRE_APPROVAL --> no dispatch
   |
   +-- ALLOW -------------------> OpenManus capability dispatch
                                      |
                                      v
                                   result/evidence
```

OpenManus may plan or expose capabilities, but it may not grant itself authority.

## Browser scope for this experiment

The pinned OpenManus source exposes Browser Use CLI 3.0 through MCP using:

- command: `uvx`
- args: `browser-use --cli-mcp`
- server id: `browser_use`

The reverse experiment tests the policy boundary around browser actions before any live external-browser dependency is considered.

## Predeclared action classes

Read-only actions do not require approval:

- `browser.read`
- `browser.extract`
- `browser.screenshot`

Side-effecting actions require explicit approval:

- `browser.click`
- `browser.input`
- `browser.submit`
- `browser.download`
- `browser.upload`

Unknown actions fail closed.

This classification belongs to the experiment adapter only. It does not change NaIA core.

## Hypotheses

- H1: OpenManus can be the host/capability layer while NaIA remains the authority layer.
- H2: read-only browser proposals can pass through NaIA policy without approval.
- H3: side-effecting browser proposals cannot reach dispatch before explicit NaIA approval.
- H4: prompt-like or tool-originated text cannot self-grant approval.
- H5: unknown browser actions fail closed.
- H6: the reverse architecture requires zero semantic changes to `src/product/service.mjs`, `domain.mjs`, and `policy.mjs`.

## Tests

- REV-01: pinned OpenManus source exposes Browser Use MCP integration.
- REV-02: read-only browser proposal is authorized and dispatched exactly once.
- REV-03: side-effecting browser proposal is blocked before approval; dispatch count remains zero.
- REV-04: explicit NaIA approval permits exactly one side-effecting dispatch.
- REV-05: prompt-like content claiming approval cannot bypass NaIA policy.
- REV-06: unknown browser action fails closed with zero dispatch.
- REV-07: action/schema mutation after approval does not inherit authorization for a different tool action.

## Acceptance gates

Reverse integration is `PASS` only if:

1. REV-01..07 all PASS.
2. Existing NaIA baseline remains 18/18 PASS.
3. No semantic changes exist under `src/product/`.
4. No OpenManus upstream source is modified.
5. Side-effecting dispatch count before approval is exactly zero.
6. Prompt/tool output cannot create approval.

## Adoption gate

Passing this experiment does **not** mean OpenManus should be adopted.

Adoption requires a later capability-value experiment showing that browser/sandbox functionality eliminates more NaIA implementation/maintenance work than the integration and dependency burden it introduces.

## Result vocabulary

- PASS
- FAIL
- NOT_EXECUTED
- BLOCKED_EXTERNAL

External browser/API availability may be `BLOCKED_EXTERNAL`; it must not invalidate locally executable authority-boundary tests.
