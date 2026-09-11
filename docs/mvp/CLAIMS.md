# MVP claim matrix

Each `PASS` below references an executed test in the current product suite.
The current repository SHA and exact command must be recorded with any
release candidate run.

| Claim | Evidence | Environment | Result | Status |
| --- | --- | --- | --- | --- |
| Sensitive keys are redacted at persistence boundaries | persistence tests in `test/product/product-slice.test.mjs` | Node 22-24, local file ports | 18 product tests passed | PASS |
| In-process idempotency prevents duplicate objectives | same-idempotency-key test | Node 22-24, in-memory ports | objective count remained 1 | PASS |
| Retry disposition distinguishes transient and permanent failure | retry tests | Node 22-24, in-memory ports | transient retried; permanent not retried | PASS |
| Unknown or partial intent is not executed | planner safety test | Node 22-24, in-memory ports | zero objectives and zero evidence | PASS |
| Controlled event path reaches confirmation and execution | local E2E test | Node 22-24, file ports | confirmation, approval, result, and evidence observed | PASS |
| Controlled schedule path deduplicates an occurrence | scheduler test | Node 22-24, fixture tick | one objective for replayed occurrence | PASS |
| Restart preserves resumable state | restart test | Node 22-24, file ports | state recovered and write completed once | PASS |
| Negative trigger and planner paths fail closed | negative-path tests | Node 22-24, in-memory ports | invalid auth, disabled, mismatch, malformed, unknown, and partial inputs had zero side effects | PASS |
| Real provider event completes E2E | no provider experiment exists | external provider | not executed | NOT_IMPLEMENTED |
| External scheduler completes E2E | no external scheduler experiment exists | external scheduler | not executed | NOT_IMPLEMENTED |
| Independent clean-environment reproduction | no independent run recorded | clean external environment | not executed | NOT_IMPLEMENTED |

`MVP_READY` is not declared because the required real-provider, real-schedule,
and independent reproduction gates are not all `PASS`.
