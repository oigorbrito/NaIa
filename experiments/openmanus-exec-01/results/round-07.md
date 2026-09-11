# OpenManus EXEC-01 — observed round 07

Status: `PASS_REPRODUCTION_02`

This record preserves the second successful clean reproduction reported from the Windows test environment.

## Observed environment

- NaIA branch: `experiment/openmanus-exec-01`
- NaIA baseline parent: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Clean run: `True`

## OpenManus contract summary

```text
tests 7
pass 7
fail 0
duration_ms 7769.5121
```

| Test | Duration | Result |
| --- | ---: | --- |
| EXEC-01 deterministic read-only tool | 2087.6130 ms | PASS |
| EXEC-02 unknown tool fails closed | 997.2616 ms | PASS |
| EXEC-03 transient failure is retryable | 955.5423 ms | PASS |
| EXEC-04 permanent failure is non-retryable | 1184.6681 ms | PASS |
| EXEC-05 write waits for NaIA approval | 1452.2002 ms | PASS |
| EXEC-06 timeout never becomes success | 128.2204 ms | PASS |
| SEC-01 prompt-like content remains data | 637.6936 ms | PASS |

## Interpretation

This is the second independent clean reproduction satisfying the OpenManus execution contract under the same pinned candidate SHA. Together with the first successful clean reproduction, the reproducibility gate is satisfied for this minimum execution-chassis experiment.

## Candidate status after round 07

```text
Baseline: PASS
Contract: PASS
Security boundary: PASS
NaIA core untouched: PASS
OpenManus upstream untouched: PASS
Clean reproduction #1: PASS
Clean reproduction #2: PASS
Minimum execution chassis candidate: ACCEPTED
Product architecture decision: UNDECIDED
```

Acceptance here applies only to the minimum execution-chassis hypothesis. It does not establish that OpenManus should be adopted as NaIA's final runtime or product architecture.