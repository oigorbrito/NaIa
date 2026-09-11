# OpenManus EXEC-01 — observed round 01

Status: `FAIL_HARNESS`

This record preserves the first execution reported from the Windows test environment. It is not counted as a candidate rejection because two harness defects were identified after the run: the 5-second cold-start timeout was below the observed startup time, and stdout parsing assumed that the final line belonged to the NaIA sidecar even though the imported runtime may emit its own log output.

## Observed environment

- NaIA branch: `experiment/openmanus-exec-01`
- NaIA baseline parent: `a8baae9b1e43496b3786a6172288e60a67df0efb`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Host: Windows PowerShell execution under `C:\Projetos\naia`
- Python environment: `.experiment-runtime\venv-openmanus`

## Observed test summary

```text
tests 3
pass 0
fail 3
duration_ms 8598.4323
```

| Test | Observed duration | Observed result | Classification |
| --- | ---: | --- | --- |
| EXEC-01 deterministic read-only tool | 5072.9647 ms | adapter timeout after 5000 ms | HARNESS_TIMEOUT |
| EXEC-02 unknown tool fails closed | 1563.0355 ms | assertion saw `ok === true` | PROTOCOL_AMBIGUITY |
| SEC-01 prompt-like content remains data | 935.2803 ms | assertion saw `ok === false` | PROTOCOL_AMBIGUITY |

## Interpretation

No semantic conclusion about OpenManus is drawn from this round. EXEC-01 crossed the configured timeout boundary by approximately 73 ms before the Node assertion completed, demonstrating that a 5-second process startup budget is unsuitable for this cold-start experiment. The contradictory EXEC-02/SEC-01 observations are consistent with an ambiguous stdout protocol because the adapter parsed the final stdout line rather than a uniquely framed sidecar response.

## Harness correction

The next round uses:

- `NAIA_RESULT:` framing for the sidecar response;
- explicit extraction of the framed line instead of the final stdout line;
- a 20-second cold-start timeout;
- stdout/stderr diagnostics when no valid frame is returned.

The acceptance criteria remain unchanged. A timeout increase is an instrumentation correction, not a candidate success criterion change; measured cold-start latency remains an experimental output.

## Candidate status after round 01

```text
OpenManus candidate: UNDECIDED
EXEC-01: NOT_VALIDLY_MEASURED
EXEC-02: NOT_VALIDLY_MEASURED
SEC-01: NOT_VALIDLY_MEASURED
NaIA core modifications: 0
OpenManus upstream modifications: 0
```
