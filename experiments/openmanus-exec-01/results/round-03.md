# OpenManus EXEC-01 — observed round 03

Status: `PASS_PARTIAL_CONTRACT`

This record preserves the first valid functional execution of the OpenManus execution adapter after harness corrections. The NaIA core and OpenManus upstream sources remained unchanged.

## Observed environment

- NaIA branch: `experiment/openmanus-exec-01`
- NaIA baseline parent: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Host: Windows PowerShell under `C:\Projetos\naia`
- Python environment: `.experiment-runtime\venv-openmanus`

## Observed test summary

```text
tests 3
pass 3
fail 0
duration_ms 2066.066
```

| Test | Observed duration | Result |
| --- | ---: | --- |
| EXEC-01 deterministic read-only tool | 739.0509 ms | PASS |
| EXEC-02 unknown tool fails closed | 593.0046 ms | PASS |
| SEC-01 prompt-like content remains data | 590.4730 ms | PASS |

## Interpretation

The tested OpenManus primitives can satisfy the current NaIA execution contract subset when isolated from OpenManus package bootstrap side effects. The experiment exercised the pinned upstream `BaseTool` and `ToolCollection` implementations while bypassing the package initializer that imports unrelated tools/configuration.

The observed per-call latency includes Python process startup, module loading, protocol transport and tool execution. It must not be interpreted as tool-only latency.

## Candidate status after round 03

```text
OpenManus candidate: ACTIVE
EXEC-01: PASS
EXEC-02: PASS
SEC-01: PASS
EXEC-03: NOT_EXECUTED
EXEC-04: NOT_EXECUTED
EXEC-05: NOT_EXECUTED
EXEC-06: NOT_EXECUTED
NaIA core modifications: 0
OpenManus upstream modifications: 0
```

This result is not sufficient for `CANDIDATE_ACCEPTED`; the full contract, baseline regression and clean reproduction gates remain outstanding.
