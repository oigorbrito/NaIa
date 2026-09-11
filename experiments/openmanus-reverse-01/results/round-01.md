# OpenManus reverse integration — observed round 01

Status: `PASS_AUTHORITY + FAIL_HARNESS_PROBE`

This round validates the reverse-integration authority boundary with OpenManus as the host/runtime candidate and NaIA as the policy/authorization authority.

## Observed environment

- NaIA branch: `experiment/openmanus-reverse-01`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Host: Windows PowerShell under `C:\Projetos\naia`
- Clean OpenManus checkout: yes

## Authority suite

```text
REV-01 PASS  6.1145 ms
REV-02 PASS  0.7146 ms
REV-03 PASS  0.2745 ms
REV-04 PASS  0.2503 ms
REV-05 PASS  0.2084 ms
REV-06 PASS  0.2331 ms
REV-07 PASS  0.3201 ms

tests 7
pass 7
fail 0
duration_ms 138.98
```

Interpretation: the reverse-integration gateway preserves the declared NaIA authority properties under the controlled harness. Read-only dispatch is allowed, side effects require explicit approval, prompt-like content cannot self-authorize, unknown actions fail closed, and authorization does not transfer across a mutated action.

## Browser MCP availability probe

The optional external probe did not yield a valid availability measurement. `uvx browser-use --help` began downloading dependencies and wrote progress to stderr; with the script-wide PowerShell `ErrorActionPreference = Stop`, PowerShell surfaced that native stderr as `NativeCommandError` and aborted before the harness could classify the native exit code.

Observed fragment:

```text
Downloading google-api-python-client (14.2MiB)
NativeCommandError
```

Classification:

```text
AUTHORITY_SUITE = PASS
BROWSER_MCP_PROBE = NOT_VALIDLY_MEASURED
PROBE_FAILURE = HARNESS_NATIVE_STDERR_HANDLING
OpenManus reverse candidate = UNDECIDED_FOR_BROWSER_VALUE
```

This is not a Browser Use candidate rejection and not a network failure conclusion. The runner is corrected in the next revision so native stderr cannot terminate the optional probe; external probe failures are classified as `BLOCKED_EXTERNAL` and never abort the experiment.
