# T5 Ownership / Fencing Contract V1

Status: CONTROL_VALIDATED / TEMPORAL_EXECUTOR_IMPLEMENTED_NOT_RUNTIME_VERIFIED

T5 tests `concurrent_worker_ownership_race`: after authority has moved from worker A to worker B, A must be unable to publish a result while B is the current owner, even before B has completed.

This is deliberately distinct from T12 (`stale_completion_after_new_owner`). T12 may test a late completion after the new owner has already committed. T5 instead tests the live ownership window itself. Terminal-state immutability is not sufficient T5 evidence.

The contract is observational. A candidate is not required to expose a numeric fencing token or use a particular locking algorithm. Candidate-native workflow/task/run identities, attempt generations, epochs, leases, task tokens, journal positions, database ownership records, or equivalent evidence are admissible when they prove the same authority transition.

## Engineering basis

The fault model follows the stale-client/fencing problem in distributed systems: ownership can advance while an old worker is paused, so correctness requires the protected authority boundary to prevent the stale worker from committing after a newer authority exists. A lease or lock-holder belief alone is not sufficient evidence.

A single Worker producing attempt 1 and attempt 2 is not admissible T5 evidence. Two concrete worker/executor process or container identities must participate.

## Deterministic schedule

Every candidate-specific T5 driver must realize this semantic order:

1. `worker A ready` — concrete worker/executor identity A is alive and addressable.
2. `old authority acquired` — A receives valid authority for one objective.
3. `old authority held` — A is prevented from completing, without destroying the durable authority and while remaining capable of submitting its old result later.
4. `worker B ready` — a distinct concrete worker/executor identity B is alive and addressable.
5. `new authority acquired` — B becomes the valid authority for the same objective after a candidate-native ownership transition.
6. `stale completion submitted during B ownership` — before B completes, A submits the old result.
7. `post-stale authority inspected` — independent/native state proves the stale submission was rejected or did not become authoritative and B remains current.
8. `new authority completion submitted` — B submits its result.
9. `final authority inspected` — final state/result is inspected and originates from B.

The schedule must use explicit barriers/events. Scheduler timing, sleep-only races, or hoping that two workers overlap are not formal T5 evidence. Candidate-native timeout/lease expiry may drive the ownership transition, but the harness must observe that B acquired authority before releasing A.

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
  "staleCompletion": {
    "attempted": true,
    "attemptedBeforeNewCompletion": true,
    "rejectedOrNonAuthoritative": true,
    "becameAuthoritative": false
  },
  "newAuthorityStillCurrentAfterStaleAttempt": true,
  "newAuthorityCompletion": {
    "attempted": true,
    "acceptedOrAuthoritative": true
  },
  "finalAuthorityIdentity": "candidate-specific identity",
  "finalResultOrigin": "new-authority",
  "durableAuthorityAlive": true,
  "deterministicScheduleObserved": true,
  "rawNativeEvidence": {}
}
```

An explicit native rejection is strongest evidence. If the API does not reject explicitly, independent candidate state must prove both that the stale result did not become authoritative and that B remained the current authority before B's own completion.

## PASS requirements

T5 PASS requires all of the following:

- worker A and worker B are distinct concrete process/container/executor identities;
- old and new authority identities are concrete and distinct;
- authority demonstrably advances from A to B for the same semantic objective;
- A remains alive/capable of submitting its old result after B takes authority;
- A's stale submission is actually attempted before B completes;
- A's stale submission is rejected or proven non-authoritative;
- A's stale submission never becomes authoritative, even transiently;
- B remains current after A's stale attempt;
- B's subsequent completion is accepted or becomes authoritative;
- final state/result originates from B;
- durable authority remains alive during the race;
- the deterministic schedule is proven;
- cleanup passes the normal formal cleanup gate.

If two worker boundaries cannot be established, takeover cannot be induced, stale completion cannot be released, current authority after the stale attempt cannot be inspected, native authority identity is unavailable, or final authority cannot be independently inspected, the run is `BLOCKED` or `INCONCLUSIVE` according to the existing rules. It must not become PASS.

## Prohibited adaptations

A T5 adapter must not add a fencing database or resource-level protection that the candidate/deployment would not normally use. The neutral T5 control may implement fencing only to validate the discriminator; candidate PASS must come from candidate-native authority semantics plus the common evaluator.

A one-worker retry test is not T5. Testing A only after B has already completed is also not T5; that belongs to T12/terminal-state protection analysis.

T7/T8 external-effect idempotency mechanisms do not substitute for T5 ownership/fencing evidence.
