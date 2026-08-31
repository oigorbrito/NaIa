# NaIa Blocker Register

Date baseline: 2026-08-31

Blockers are recorded so they do not stop unrelated work and are never converted into inferred PASS results.

| ID | Scope | Evidence | Impact | Status | Continue-around strategy |
|---|---|---|---|---|---|
| B001 | Local candidate installation | `git ls-remote https://github.com/temporalio/sdk-typescript.git HEAD` failed with `Could not resolve host: github.com`; `npm view` did not complete in the allowed execution window | Cannot install/clone finalist runtimes in the current local shell | OPEN / EXTERNAL_ENV | Continue source/upstream-test audit through GitHub connector; keep local candidate results BLOCKED |
| B002 | GitHub Actions runner | Research Chassis Harness matrix jobs were created for Node 22 and 24 but both ended before steps; `runner_id=0`, no runner assigned, logs unavailable | Cannot use repository CI as candidate execution environment yet | OPEN / EXTERNAL_ENV | Keep local neutral harness evidence; continue versioning adapters/specs; do not infer remote PASS/FAIL |

## Rules

- A blocker is not a defect in NaIa or in a candidate unless evidence connects it to that code.
- A blocker is not a PASS.
- Work that does not require the blocked boundary continues.
- When the boundary becomes available, the blocked test resumes from the recorded version/commit.

## Current blocked results

```text
LOCAL_FINALIST_RUNTIME_EXECUTION = BLOCKED_B001
REMOTE_CHASSIS_HARNESS_EXECUTION = BLOCKED_B002
NEUTRAL_ORACLE_LOCAL = PASS
NEUTRAL_CRASH_CONTROLLER_LOCAL = PASS
CHASSIS_WINNER = NOT_SELECTED
BENCHMARK_TO_BEAT = NOT_SELECTED
```
