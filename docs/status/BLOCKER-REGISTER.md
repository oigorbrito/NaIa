# NaIa Blocker Register

Date baseline: 2026-08-31
Last reconciled: 2026-09-03

Blockers are recorded so they do not stop unrelated work and are never converted into inferred PASS results.

| ID | Scope | Evidence | Impact | Status | Continue-around strategy |
|---|---|---|---|---|---|
| B001 | Local candidate installation/execution | Recorded local shell could not resolve `github.com` / install exact finalist runtimes | Exact local candidate runtime evidence is unavailable from that environment | OPEN / EXTERNAL_ENV | Preserve exact frozen profiles and execute when prerequisites are available; source/structural evidence is not runtime PASS |
| B002 | GitHub Actions runner | Run `33801754420`, attempt 2, at Block 1 closing HEAD completed with Node 22 failure and Node 24 cancelled; both jobs exposed `steps=null` | Repository CI cannot currently serve as formal candidate execution evidence | OPEN / EXTERNAL_ENV / REPRODUCED_2026-09-03 | Keep result classified as `BLOCKED_REMOTE_CI_PRE_RUNNER`, not candidate FAIL; resume when jobs receive a runner and execute steps |
| B003 | Trigger.dev self-hosted T7 runtime proof | Exact runner workload-container T7 hook is structurally implemented, but no accepted self-hosted runtime receipt proves identity, SIGKILL, control-plane survival, recovery, single external apply and cleanup | Trigger.dev T7 cannot receive runtime PASS/FAIL from structural evidence alone | OPEN / RUNTIME_EVIDENCE | Execute frozen self-hosted profile; retain BLOCKED until receipt exists |
| B004 | Trigger.dev critical structural coverage | T5/T11/T12/T16 formal candidate executors are not implemented in the frozen profile | Trigger.dev cannot be promotion-qualified across the full critical set | OPEN / STRUCTURAL_GAP | Keep candidate conditional for Block 2; implement equivalent critical paths or explicitly exclude it from benchmark admission by policy/evidence |

## Rules

- A blocker is not a defect in NaIa or in a candidate unless evidence connects it to that code.
- A blocker is not a PASS.
- Work that does not require the blocked boundary continues.
- When the boundary becomes available, the blocked test resumes from the recorded version/commit.

## Current state

```text
BLOCK_1_STRUCTURAL_CONSOLIDATION = PASS
BLOCK_2_RUNTIME_QUALIFICATION = BLOCKED_EXTERNAL_EXECUTION_ENVIRONMENT
LOCAL_FINALIST_RUNTIME_EXECUTION = BLOCKED_B001
REMOTE_CHASSIS_HARNESS_EXECUTION = BLOCKED_B002
TRIGGERDEV_T7_RUNTIME = BLOCKED_B003
TRIGGERDEV_FULL_CRITICAL_ADMISSION = BLOCKED_B004
FORMAL_RUNTIME_QUALIFICATION = NOT_EXECUTED
FORMAL_LEDGER_APPEND = CLOSED
CHASSIS_WINNER = NOT_SELECTED
BENCHMARK_TO_BEAT = NOT_SELECTED
```

Receipt: `docs/evidence/BLOCK-2-RUNTIME-QUALIFICATION-BLOCKED-2026-09-03.md`.
