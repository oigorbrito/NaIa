# Durable Agent / OpenWorkflow structural evidence — 2026-09-28

Status: STRUCTURALLY_INCOMPLETE_NOT_RUNTIME_EXECUTED

Decision state remains:

- CHASSIS_WINNER = NOT_SELECTED
- BENCHMARK_TO_BEAT = NOT_SELECTED

This note records a pre-triage structural evaluation only. It is not a candidate PASS or FAIL, does not add Durable Agent to the frozen formal benchmark candidate set, and does not fill any repetition in the preregistered ledger.

## Frozen identities

NaIA source revision:

- `388c17f7593c5f190832191593702632c1c36ca6`

Durable Agent source revision:

- repository: `Chigala/durable-agent`
- revision: `2885005f019d49a1059726867496dee88b38231a`

Dependency identity observed in the candidate lockfile:

- `openworkflow@0.4.1`
- `@openworkflow/backend-postgres@0.4.0`

The evaluation applies to this pinned combination. A later OpenWorkflow release or a modified Durable Agent dependency set is a distinct candidate profile and must not inherit this result.

## Scope

The smallest defensible pre-triage slice used the existing NaIA contracts:

- T5 — ownership / fencing
- T11 — cancel / crash / retry
- T12 — stale completion after new authority
- T16 — semantic compatibility

No candidate-specific acceptance semantics were introduced.

## Observed structural mechanisms

Durable Agent delegates durable workflow execution to OpenWorkflow. Source/tests inspected at the frozen Durable Agent revision expose step-based durable execution and cancellation through the underlying workflow handle.

The inspected dependency profile is sufficient to justify further reasoning about crash/replay behavior, but structural inspection is not runtime proof and is not promoted to a formal PASS.

## T5 — ownership / fencing

Result: BLOCKED_STRUCTURAL

The T5 contract requires native candidate authority sufficient to create two distinguishable ownership generations and then prove that a completion from the superseded authority is rejected or independently non-authoritative.

No candidate-native lease, fencing token, ownership generation, or equivalent stale-writer authority boundary was identified in the inspected Durable Agent surface for the pinned dependency profile.

Implementing that property in a NaIA adapter would make the harness provide the semantic property under test. Therefore no T5 formal executor is created from this evidence.

T5 PASS = NOT_CLAIMED.

## T11 — cancel / crash / retry

Result: INCOMPLETE_STRUCTURAL

A cancellation API is observable through the workflow abstraction, but API presence does not satisfy the NaIA T11 contract.

T11 requires evidence that cancellation authority is durably established before the injected crash, recovery proceeds for the same objective identity, and post-cancel unauthorized progress is prevented under an independent oracle.

That causal schedule was not demonstrated for the pinned candidate profile.

T11 PASS = NOT_CLAIMED.

## T12 — stale completion

Result: BLOCKED_STRUCTURAL

T12 requires an old authority to preserve a completion capability, a newer authority to become authoritative and complete, and the old authority then to submit its stale completion without changing the authoritative result.

Because the required candidate-native ownership/fencing boundary was not identified for T5, the same missing primitive prevents a non-circular T12 executor.

T12 PASS = NOT_CLAIMED.

## T16 — semantic compatibility

Result: PLAUSIBLE_NOT_EXECUTED

The workflow abstraction provides a plausible integration surface for a T16 profile discriminator, but no candidate runtime execution against the NaIA T16 contract was performed.

T16 PASS = NOT_CLAIMED.

## Pre-triage disposition

```text
DURABLE_AGENT_PRETRIAGE = STRUCTURALLY_INCOMPLETE

T5  = BLOCKED_STRUCTURAL
T11 = INCOMPLETE_STRUCTURAL
T12 = BLOCKED_STRUCTURAL
T16 = PLAUSIBLE_NOT_EXECUTED

FORMAL_RUNTIME_EXECUTION = NOT_STARTED
FORMAL_LEDGER_RECORDS = 0
QUALIFIED = NO
REJECTED_GLOBALLY = NO
```

The candidate remains potentially useful for a separately specified execution profile whose authority model does not require distributed multi-writer fencing. Such a profile must be preregistered independently and must not weaken or reinterpret the current T5/T12 contracts.

## Governance boundary

This result must not be promoted as:

- proof that Durable Agent fails all durability requirements;
- proof that OpenWorkflow lacks every possible concurrency-control mechanism;
- a formal benchmark FAIL;
- evidence for changing existing NaIA invariants;
- evidence for selecting a chassis winner.

The only supported conclusion is that the frozen Durable Agent + OpenWorkflow profile did not expose enough candidate-native authority semantics to construct the current NaIA T5/T12 experiments without the adapter supplying the property under test.

## Re-entry condition

Re-open this candidate for the current chassis gate only if one of the following becomes available and can be pinned:

1. candidate-native lease/ownership generation plus stale-writer rejection;
2. a native completion token or equivalent authority artifact whose stale submission can be independently observed as rejected/non-authoritative;
3. durable cancellation evidence sufficient to implement the existing T11 causal schedule without candidate-specific success semantics.

A dependency upgrade is a new candidate profile and requires fresh structural qualification.
