# VALUE PROTOCOL — OpenManus reverse integration

## Question

Does using OpenManus as the operational host for browser/computer-use materially reduce infrastructure that NaIA would otherwise need to build, while preserving NaIA authority semantics?

This protocol is declared before observing a live browser task result.

## Compared architectures

A. NaIA standalone.
B. NaIA hosting OpenManus as an execution adapter.
C. OpenManus hosting execution capabilities while NaIA remains the policy/objective/evidence authority through the reverse gateway.

## Scope

This experiment evaluates browser/computer-use capability only. It does not claim that OpenManus is globally superior, and it does not authorize replacement of NaIA domain semantics.

## Baseline facts to measure

NaIA baseline tool catalog must be inspected from `src/product/tools.mjs`.
OpenManus capability inventory must be inspected at pinned SHA `3309bf4e416fb1c74b008f3e86494439a31bad53`.

## Capability dimensions

1. Browser navigation / extraction.
2. Browser interaction / form actions.
3. GUI computer-use.
4. Screenshots / visual state.
5. Shell/process execution.
6. MCP tool transport.
7. Sandboxed execution hooks.

A capability counts as PRESENT only if a concrete source primitive exists at the pinned revision. Documentation-only claims do not count.

## Authority gates

The reverse architecture is eligible only if all REV-01..REV-07 pass:

- unknown actions fail closed;
- side effects do not dispatch before NaIA approval;
- prompt content cannot grant authority;
- approval does not transfer after action mutation;
- authorized read-only work dispatches once;
- authorized side effects dispatch once.

## Adoption decision

`ADOPT_FOR_MVP` requires all of the following:

1. authority suite PASS;
2. at least one real browser task PASS through the reverse gateway;
3. OpenManus supplies at least 3 capability dimensions absent from NaIA baseline;
4. NaIA core files modified = 0 during evaluation;
5. OpenManus upstream files modified = 0;
6. no second independent planner is required for deterministic execution decisions;
7. external setup cost is recorded and accepted explicitly rather than ignored.

`DEFER_ADOPTION` when source evidence shows substantial capability gain but a real browser task has not yet passed.

`REJECT_FOR_MVP` when authority gates fail, integration requires semantic changes to NaIA core, or the live capability cannot be exercised reproducibly after harness defects are excluded.

## Evidence vocabulary

- PASS
- FAIL
- NOT_EXECUTED
- BLOCKED_EXTERNAL
- FAIL_HARNESS

## Current decision rule

Static capability inventory may justify continuing evaluation but cannot by itself produce `ADOPT_FOR_MVP`.
A live browser task is mandatory before adoption.
