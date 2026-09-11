# VALUE DECISION — OpenManus reverse integration

## Current classification

`DEFER_ADOPTION`

This is not a rejection.

## Observed evidence

### Authority

Observed user execution:

- REV-01 PASS
- REV-02 PASS
- REV-03 PASS
- REV-04 PASS
- REV-05 PASS
- REV-06 PASS
- REV-07 PASS
- suite: 7/7 PASS

The reverse architecture can preserve NaIA authority while OpenManus is treated as the operational host/capability provider.

### Capability delta

NaIA baseline `src/product/tools.mjs` currently exposes local primitives for time, text, and note writing. It contains no native browser or computer-use primitive.

At pinned OpenManus SHA `3309bf4e416fb1c74b008f3e86494439a31bad53`, concrete source primitives exist for:

- Browser Use CLI 3.0 over MCP;
- browser execution and screenshot transport;
- GUI computer use including mouse, keyboard, screenshots;
- shell execution;
- MCP client transport;
- crawler tooling;
- sandbox-oriented computer-use integration.

This is a material capability delta, not a popularity or feature-count argument.

### Integration footprint

All reverse-integration changes remain under:

`experiments/openmanus-reverse-01/`

NaIA core modifications during evaluation: 0.
OpenManus upstream modifications: 0.

## Why adoption is still deferred

The predeclared VALUE_PROTOCOL requires at least one real browser task through the NaIA reverse gateway. Source inspection and mocked dispatch are insufficient for `ADOPT_FOR_MVP`.

A deterministic live test now exists:

`live-browser.test.mjs`

It starts a loopback HTTP fixture, asks Browser Use to open it and read the document title, and requires the request to pass through the NaIA reverse gateway. It uses no external website and no LLM.

## Decision transition

If LIVE-01 passes while REV-01..REV-07 and VAL-01..VAL-06 remain passing, the architecture becomes eligible for `ADOPT_FOR_MVP` consideration.

If LIVE-01 is blocked by browser/runtime installation, classify `BLOCKED_EXTERNAL` and retain `DEFER_ADOPTION`.

If LIVE-01 repeatedly fails after harness/environment defects are excluded, classify the live capability FAIL and evaluate `REJECT_FOR_MVP`.

## MVP interpretation

OpenManus should not replace NaIA authority semantics. The viable reverse architecture is:

OpenManus: operational host, browser/computer-use/shell/MCP capabilities.
NaIA: objectives, policy, approval, idempotency, evidence, persistence safety, continuity, product identity.

No adoption decision should introduce duplicate independent planners for deterministic tool authorization.
