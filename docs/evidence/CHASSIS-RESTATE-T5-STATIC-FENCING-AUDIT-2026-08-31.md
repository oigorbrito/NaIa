# Restate T5 Static Fencing Audit — 2026-08-31

Status: STATIC_MECHANISM_CONFIRMED / CANDIDATE_T5_NOT_EXECUTED

Candidate: Restate
Profile: `restate-ts-v1`
Server: `v1.7.8`
SDK: `@restatedev/restate-sdk = 1.16.9`
Critical mutant: `T5 concurrent_worker_ownership_race`

## Scope

This audit determines whether Restate v1.7.8 contains a candidate-native authority/fencing mechanism capable of supporting the preregistered T5 experiment. It does **not** promote documentation or source inspection to candidate PASS.

## Exact upstream mechanism

At Restate server tag `v1.7.8`, `crates/invoker-impl/src/invocation_state_machine.rs` stores a `FencingToken` in every `InvocationStateMachine`. The source states that the token is the invoker-task generation represented by that state machine and is stamped onto every effect emitted so the partition processor can fence stale effects from a previous attempt.

At the same tag, `crates/invoker-impl/src/state_machine_manager.rs` implements `is_stale_fencing_token(invocation_id, fencing_token)`. It returns true when an in-flight state machine exists for the same invocation but has a different fencing token. The source comment explicitly states that this fences output from an aborted task that is still draining after the invocation has already restarted, preventing that output from mutating the new attempt state machine or being emitted as an effect stamped with the newer attempt epoch.

`crates/invoker-impl/src/lib.rs` additionally defines `FencedEffect` construction: effects are tagged with the attempt's fencing token before crossing toward the partition processor.

## T5 relevance

The mechanism is directly relevant to the T5 invariant:

- old and new attempts have distinct authority generations (`FencingToken`);
- output carries the generation that produced it;
- a stale generation is detected against the currently registered state machine;
- stale output is intended to be prevented from mutating the new attempt or being relabeled with the new epoch.

This is stronger static evidence than a lock/lease claim alone because the stale identity is bound to the produced effect and compared against current invocation authority.

## What remains unproven

No NaIa Restate T5 candidate run has executed the required deterministic two-boundary schedule. Therefore the following remain `NOT_EXECUTED`:

1. establish concrete old and new Restate execution/attempt identities for the same semantic objective;
2. hold old execution while allowing a newer attempt to become current;
3. submit old/stale output during the newer ownership window, before the new attempt completes;
4. independently inspect that the stale output did not become authoritative and that the newer authority remains current;
5. complete with the newer attempt and inspect final authority;
6. prove cleanup;
7. repeat according to the preregistered formal plan.

## Classification

`RESTATE_T5_NATIVE_FENCING_MECHANISM = STATIC_CONFIRMED`

`RESTATE_T5_EXECUTOR = NOT_IMPLEMENTED`

`RESTATE_T5_RUNTIME = NOT_EXECUTED`

`RESTATE_T5_VERDICT = NOT_ASSIGNED`

This evidence must not be used to fill a T5 ledger slot and must not be reported as PASS, FAIL, PARTIAL, or executed candidate evidence.

## Blocker interaction

B001 still blocks candidate runtime/package execution in the current environment. This static audit is independent of B001 and therefore advances mechanism qualification without changing runtime status.

The Restate server BSL 1.1 license gate remains separate from technical qualification.