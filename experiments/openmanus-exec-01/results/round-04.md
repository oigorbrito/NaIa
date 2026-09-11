# OpenManus EXEC-01 — observed round 04

Status: `PASS_CONTRACT`

This record preserves the first execution in which the complete candidate contract suite passed against the pinned OpenManus runtime.

## Observed environment

- NaIA branch: `experiment/openmanus-exec-01`
- NaIA baseline parent: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Host: Windows PowerShell execution under `C:\Projetos\naia`
- Python environment: `.experiment-runtime\venv-openmanus`

## Observed test summary

```text
tests 7
pass 7
fail 0
duration_ms 6199.1631
```

| Test | Observed duration | Result |
| --- | ---: | --- |
| EXEC-01 deterministic read-only tool | 1515.6011 ms | PASS |
| EXEC-02 unknown tool fails closed | 756.4773 ms | PASS |
| EXEC-03 transient failure normalized retryable | 837.3620 ms | PASS |
| EXEC-04 permanent failure normalized non-retryable | 847.4939 ms | PASS |
| EXEC-05 write action blocked before NaIA approval | 1092.6521 ms | PASS |
| EXEC-06 timeout never becomes success | 174.8329 ms | PASS |
| SEC-01 prompt-like content remains data | 751.7651 ms | PASS |

## Interpretation

The complete candidate execution contract passed in this run. The result supports the hypothesis that the pinned OpenManus `ToolCollection` primitive can be adapted behind the NaIA execution port without re-planning and while preserving the approval boundary for write actions.

This result does **not** yet establish candidate acceptance. The protocol still requires the baseline suite to pass in the same experiment runner and at least two successful clean-environment reproductions.

## Candidate status after round 04

```text
OpenManus candidate: PROVISIONAL_PASS
EXEC-01: PASS
EXEC-02: PASS
EXEC-03: PASS
EXEC-04: PASS
EXEC-05: PASS
EXEC-06: PASS
SEC-01: PASS
Baseline 18/18 in same runner: PENDING_VERIFICATION
Clean reproduction #1: NOT_EXECUTED
Clean reproduction #2: NOT_EXECUTED
NaIA core modifications: 0 (to be re-verified by diff)
OpenManus upstream modifications: 0
```
