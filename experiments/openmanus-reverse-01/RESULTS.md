# OM-NAIA-01 results

## Status

`PRECHECK_COMPLETE`

This artifact records the work executable during experiment construction. It is not yet the final acceptance result from the user's canonical Windows checkout.

## Observed source evidence

Pinned OpenManus commit inspected: `3309bf4e416fb1c74b008f3e86494439a31bad53`.

Observed in `app/agent/manus.py`:

- Browser Use server id: `browser_use`
- stdio command: `uvx`
- args: `browser-use --cli-mcp`
- Browser Use MCP tools are added to `available_tools`

Observed in `app/agent/browser.py`:

- `BrowserAgent` initializes an MCP stdio connection using `uvx browser-use --cli-mcp`
- the browser agent is therefore a concrete candidate host for browser capability

REV-01 source evidence: `PASS`.

## Isolated gateway preflight

The reverse gateway logic was reconstructed in an isolated Node environment with the baseline NaIA approval-policy implementation and executed before commit completion.

Preflight cases executed:

- read-only browser action dispatches: PASS
- side-effecting action blocked without approval: PASS
- explicit approval permits action: PASS
- hostile input cannot self-approve: PASS
- unknown action fails closed: PASS
- approval does not transfer to mutated action: PASS

Preflight summary: `6/6 PASS`.

This preflight checks the experiment logic itself; it does not replace execution from the canonical repository checkout.

## Canonical experiment status

- REV-01: PASS (pinned-source inspection)
- REV-02: NOT_EXECUTED in canonical checkout
- REV-03: NOT_EXECUTED in canonical checkout
- REV-04: NOT_EXECUTED in canonical checkout
- REV-05: NOT_EXECUTED in canonical checkout
- REV-06: NOT_EXECUTED in canonical checkout
- REV-07: NOT_EXECUTED in canonical checkout
- NaIA baseline 18/18 for this branch: NOT_EXECUTED
- Browser MCP external availability: NOT_EXECUTED

## Architectural interpretation so far

The inverse direction is technically coherent without changing NaIA policy semantics:

```text
OpenManus proposes capability action
        -> NaIA authority gateway
        -> dispatch only when authorized
```

No adoption conclusion is drawn yet. The next empirical question after the authority suite is whether live browser/sandbox capability provides enough implementation reduction to justify OpenManus's dependency/runtime burden.
