# T5 Ownership / Fencing Contract V1

Status: CONTROL_VALIDATED / CANDIDATE_EXECUTORS_NOT_IMPLEMENTED

T5 tests the invariant `stale_attempt_cannot_overwrite_current_authority` under a controlled ownership transition between two concrete worker/executor boundaries.

The contract is observational. A candidate is not required to expose a numeric fencing token or use a particular locking algorithm. Candidate-native workflow/task/run identities, attempt generations, epochs, leases, task tokens, journal positions, database ownership records, or equivalent evidence are admissible when they prove the same authority transition.

## Engineering basis

The fault model follows the established stale-client/fencing problem in distributed systems: ownership can advance while an old worker is paused, so correctness requires the protected authority boundary to prevent the stale worker from committing after a newer authority exists. A lease or lock-holder belief alone is not sufficient evidence.

T5 is deliberately distinct from T12. T12 focuses on a stale completion after a new owner exists. T5 additionally requires two concrete worker/executor process or container identities participating in the ownership transition. A single Worker producing attempt 1 and attempt 2 is not admissible T5 evidence.

## Deterministic schedule

Every candidate-specific T5 driver must realize the following semantic order:

1. `worker A ready` — concrete worker/executor identity A is alive and addressable.
2. `old authority acquired` — A receives valid authority for one objective.
3. `old authority held` — A is prevented from completing, without destroying the durable authority.
4. `worker B ready` — a distinct concrete worker/executor identity B is alive and addressable.
5. `new authority acquired` — B becomes the valid authority for the same objective after the candidate-native ownership transition.
6. `new authority completion submitted` — B submits a terminal/commit result that becomes authoritative.
7. `stale completion submitted` — A is released and submits its older completion after B is authoritative.
8. `final authority inspected` — independent candidate state is queried after both submissions.

The schedule must be driven by explicit barriers/events. Scheduler timing, sleep-only races, or hoping that two workers overlap are not admissible as formal T5 evidence. Candidate-native timeout/lease expiry may be part of the ownership transition, but the harness must wait for explicit evidence that B acquired new authority before releasing A.

## Required T5 evidence

A candidate driver must produce machine-readable evidence sufficient to populate:

```json
{
  "oldWorkerIdentity": "worker/process/container A",
  "newWorkerIdentity": "worker/process/container B",
  "oldAuthorityIdentity": "candidate-specific identity",
  "newAuthorityIdentity": "candidate-specific identity",
  "authorityAdvanced": true,
  "oldAuthorityHeldUntilTakeover": true,
  "newAuthorityCompletion": {
    "attempted": true,
    "acceptedOrAuthoritative": true
  },
  "staleCompletion": {
    "attempted": true,
    "rejectedOrNonAuthoritative": true
  },
  "finalAuthorityIdentity": "candidate-specific identity",
  "finalResultOrigin": "new-authority",
  "durableAuthorityAlive": true,
  "deterministicScheduleObserved": true,
  "rawNativeEvidence": {}
}
```

`rejectedOrNonAuthoritative` deliberately allows engines whose stale completion call returns a transport/protocol result other than an explicit rejection, provided independent final state proves that the stale completion could not become authoritative. A stale completion that silently overwrites B is FAIL.

## PASS requirements

T5 PASS requires all of the following:

- worker A and worker B are distinct concrete process/container/executor identities;
- old and new authority identities are concrete and distinct;
- authority demonstrably advances from A to B for the same semantic objective;
- A remains capable of submitting its stale result after B takes authority;
- B's completion is accepted or becomes authoritative;
- A's stale completion is actually attempted after B becomes authoritative;
- A's stale completion is rejected or independently proven non-authoritative;
- final authoritative state/result originates from B, never A;
- the candidate's durable authority remains alive during the ownership transition;
- the execution follows the deterministic schedule above;
- cleanup is independently verified under the normal formal cleanup gate.

If two worker boundaries cannot be established, takeover cannot be induced, stale completion cannot be released, native authority identity is unavailable, or final authority cannot be independently inspected, the run is `BLOCKED` or `INCONCLUSIVE` according to the existing setup/runtime rules. It must not be promoted to PASS.

## Prohibited adaptations

A T5 adapter must not add a new fencing database or resource-level protection that the candidate/deployment would not normally use. The neutral T5 control model may implement fencing solely to validate the harness discriminator; candidate PASS must come from candidate-native authority semantics plus the common observational evaluator.

A one-worker retry test, even when it produces multiple task/attempt tokens, is not T5. Such evidence may inform T12 or adapter development but cannot fill a T5 ledger slot.

T7/T8 external-effect idempotency mechanisms do not substitute for T5 ownership/fencing evidence.
