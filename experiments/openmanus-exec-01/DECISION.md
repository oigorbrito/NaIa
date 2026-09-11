# OpenManus EXEC-01 decision

## Decision

`CANDIDATE_ACCEPTED` for the minimum NaIA execution-chassis hypothesis.

This does **not** mean OpenManus is selected as the final NaIA architecture.

## Acceptance evidence

- NaIA baseline: 18/18 PASS.
- OpenManus contract: 7/7 PASS.
- Unknown tools fail closed.
- Transient/permanent failures preserve retry classification.
- `note.write` is not sent to the runtime before NaIA approval.
- Timeout never becomes success.
- Prompt-like content remains data and cannot trigger an additional tool.
- NaIA semantic core files were not modified.
- OpenManus upstream source was not modified.
- Two clean reproductions succeeded using pinned OpenManus SHA `3309bf4e416fb1c74b008f3e86494439a31bad53`.

## Scope of the conclusion

The experiment supports the claim that OpenManus can serve as a deterministic execution chassis behind NaIA's existing authority boundary.

It does not yet support claims that:

- OpenManus reduces total MVP engineering cost;
- OpenManus should be embedded under NaIA;
- NaIA should be embedded into OpenManus;
- OpenManus should own planning or policy;
- OpenManus provides a net benefit for browser, sandbox, MCP, computer-use, or assistant-product capabilities.

## Next discriminating experiment

Evaluate architecture direction rather than basic tool execution:

1. `A — NaIA standalone`
2. `B — NaIA -> OpenManus execution runtime`
3. `C — OpenManus host -> NaIA authority/product layer`

Use a capability that materially matters to the intended pocket-secretary product, preferably browser/computer-use or sandboxed action execution. Compare preserved NaIA invariants, integration LOC, removable NaIA infrastructure, dependency/runtime cost, latency, restart behavior, security, and maintenance burden.

Do not adopt OpenManus into the MVP solely because EXEC-01 passed.