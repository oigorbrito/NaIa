# Sentinel Security Journal

## 2025-05-18 - Policy Authorization Check Relied Solitary on Action Flag

**Vulnerability:** Approval policy checked `step.action.requiresApproval` boolean flag alone. If a step had `risk: 'LOCAL_WRITE'` but `requiresApproval` was false or omitted, the policy treated it as `allowed: true` with reason `'read-only'`, bypassing user authorization.

**Learning:** Relying on boolean flags produced by external or dynamic components (like planners) without enforcing risk level invariants creates authorization bypass vulnerabilities.

**Prevention:** Always evaluate security policy against fundamental classification properties (like risk level `LOCAL_WRITE` vs `READ_ONLY`) rather than trusting flags passed on individual steps.
