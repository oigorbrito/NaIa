# T12 Stale Completion After New Owner Contract V1

Status: CONTROL_SPECIFIED / TEMPORAL_DBOS_RESTATE_EXECUTORS_IMPLEMENTED_NOT_RUNTIME_VERIFIED

T12 tests `stale_completion_after_new_owner`: after a newer candidate-native authority has completed or otherwise become authoritative, an older attempt must not overwrite that result when its delayed completion arrives later.

T12 is deliberately distinct from T5. T5 tests a live concurrent ownership race and requires two concrete worker/executor boundaries while the new owner is still current but not yet complete. T12 tests the late-completion boundary after the newer authority has already committed. A terminal-state check alone is not enough unless the old completion is actually submitted and the final candidate state is independently inspected afterward.

## Methodological basis

The schedule follows the stale-client/fencing failure model used in distributed-systems testing: preserve an obsolete authority token/attempt, advance authority, commit through the newer authority, then release the obsolete completion and inspect whether it can alter durable state. The harness must control this ordering explicitly rather than infer it from timing.

This contract follows the project experiment protocol: preserve software/environment/provenance, use deterministic barriers where practical, record raw observations, and never promote absent fault injection or blocked setup to PASS/FAIL.

## Deterministic schedule

Every candidate-specific T12 driver must realize this semantic order:

1. `old authority acquired` — attempt/owner A receives concrete candidate-native authority for one objective.
2. `old completion held` — A's completion payload/authority remains available but is not submitted.
3. `new authority acquired` — authority advances to a distinct candidate-native identity B for the same objective.
4. `new authority committed` — B's result becomes authoritative and is independently observable.
5. `stale completion submitted` — A's preserved completion is submitted after B is authoritative.
6. `final authority inspected` — candidate-native durable state is inspected after the stale submission.

The old completion must be genuinely capable of reaching the candidate's normal completion/commit boundary. Replacing the submission with a local mock, omitting the native authority credential/token, or checking only application memory is not admissible.

## Required evidence

```json
{
  "oldAuthorityIdentity": "candidate-native-old-authority",
  "newAuthorityIdentity": "candidate-native-new-authority",
  "authorityAdvanced": true,
  "oldCompletionHeldUntilNewCommit": true,
  "newAuthorityCompletion": {
    "attempted": true,
    "acceptedOrAuthoritative": true
  },
  "staleCompletion": {
    "attempted": true,
    "attemptedAfterNewCommit": true,
    "rejectedOrNonAuthoritative": true,
    "becameAuthoritative": false
  },
  "finalAuthorityIdentity": "candidate-native-new-authority",
  "finalResultOrigin": "new-authority",
  "durableAuthorityAlive": true,
  "deterministicScheduleObserved": true,
  "rawNativeEvidence": {}
}
```

An explicit native stale-token/stale-attempt rejection is strongest evidence. If the API returns success or an ambiguous transport result, independent final-state evidence may still prove the stale completion non-authoritative, but the stale completion must have actually crossed the candidate's normal completion boundary.

## PASS requirements

T12 PASS requires all of the following:

- old and new authority identities are concrete and distinct;
- authority demonstrably advances from A to B for the same semantic objective;
- A's completion remains held until B is authoritative;
- B's completion is accepted or independently proven authoritative;
- A's stale completion is actually submitted after B's commit;
- A's stale completion is rejected or independently proven non-authoritative;
- the stale completion never replaces B's durable result;
- final durable state/result originates from B;
- durable authority remains alive while the stale completion is challenged;
- deterministic schedule evidence is present;
- cleanup passes the formal cleanup gate.

If the old completion cannot be preserved, a newer authority cannot be induced, the stale completion cannot be submitted, or final authority cannot be independently inspected, the record is BLOCKED or INCONCLUSIVE under the existing runtime rules. It must not become PASS.

## Candidate-specific admitted observations

Temporal may use candidate-native activity task tokens/attempt identity and native stale-token rejection, provided the new authority has already committed before the old token is submitted.

DBOS may use candidate-native executor/recovery ownership and workflow status, provided the older execution is demonstrably held through the newer authoritative completion and the old write is actually challenged afterward.

Restate may use two distinct deployment identities for the same durable invocation, with candidate-native `pause` plus `resume?deployment=latest` to establish the newer authority. Deployment B must complete first and its result must be independently observed before A is released. A counts as a stale completion attempt only if the correlated old service-protocol HTTP response reaches transport `finish` after B is authoritative. The driver must then re-read the workflow output and prove it still originates from B. If A's old request was already closed and cannot cross the normal completion boundary, `staleCompletion.attempted` remains false and the run is not T12-complete. Upstream fencing-token evidence supports the test design but is not candidate runtime evidence.

## Prohibited adaptations

Candidate adapters must not add a new fencing database or side channel solely to pass T12. The stale completion must be judged at the candidate's native durable authority boundary. Provider idempotency from T7/T8/T15 does not substitute for stale workflow/task completion fencing.
