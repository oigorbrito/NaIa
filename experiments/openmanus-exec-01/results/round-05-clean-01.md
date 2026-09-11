# OpenManus clean reproduction 01

Status: `PASS`

This record preserves the first successful clean reproduction reported from the Windows test environment after fixing the PowerShell pip bootstrap command.

## Environment

- NaIA branch: `experiment/openmanus-exec-01`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Host: Windows PowerShell under `C:\Projetos\naia`
- Node: `v24.18.0`
- Python: `3.13.14`
- Clean runtime reset: `True`

## NaIA baseline

Observed in the same clean runner execution before candidate setup:

```text
tests 18
pass 18
fail 0
```

Baseline gate: `PASS`.

## OpenManus contract

```text
EXEC-01 PASS 2270.8044 ms
EXEC-02 PASS 629.3182 ms
EXEC-03 PASS 497.6577 ms
EXEC-04 PASS 539.9232 ms
EXEC-05 PASS 570.7061 ms
EXEC-06 PASS 131.5027 ms
SEC-01  PASS 519.6029 ms

tests 7
pass 7
fail 0
duration_ms 6768.2552
```

Contract gate: `PASS`.

## Reproduction status

```text
clean reproduction successes: 1 / 2 required
clean reproduction failures attributable to candidate: 0
NaIA core modifications: 0
OpenManus upstream modifications: 0
```

A second independent `run.ps1 -Clean` success is still required before the reproducibility gate can be marked complete.
