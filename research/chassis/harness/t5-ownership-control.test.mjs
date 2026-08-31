import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT5Control } from './t5-ownership-control.mjs';

test('T5 fenced control rejects stale completion after takeover and before current owner completes', () => {
  const result = executeDeterministicT5Control({ unsafe: false });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.oldOwner.token, 1);
  assert.equal(result.newOwner.token, 2);
  assert.equal(result.staleCompletion.stale, true);
  assert.equal(result.staleCompletion.accepted, false);
  assert.equal(result.staleCompletion.reason, 'STALE_AUTHORITY_REJECTED');
  assert.equal(result.stateAfterStaleAttempt.authoritativeCompletion, null);
  assert.equal(result.currentCompletion.accepted, true);
  assert.equal(result.finalState.authoritativeCompletion.ownerId, 'owner-B');
  assert.equal(result.finalState.authoritativeCompletion.value, 'new-owner-result');
});

test('T5 unfenced negative control exposes transient stale authority even if B later wins final state', () => {
  const result = executeDeterministicT5Control({ unsafe: true });
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.staleCompletion.stale, true);
  assert.equal(result.staleCompletion.accepted, true);
  assert.equal(result.checks.staleCompletionRejected, false);
  assert.equal(result.checks.staleAttemptDidNotPublishOutcome, false);
  assert.equal(result.stateAfterStaleAttempt.authoritativeCompletion.ownerId, 'owner-A');
  assert.equal(result.stateAfterStaleAttempt.authoritativeCompletion.value, 'stale-owner-result');
  assert.equal(result.currentCompletion.accepted, true);
  assert.equal(result.finalState.authoritativeCompletion.ownerId, 'owner-B');
});

test('T5 control remains discriminating for 100 deterministic ownership races', () => {
  for (let repetition = 1; repetition <= 100; repetition += 1) {
    const safe = executeDeterministicT5Control({ unsafe: false, objectiveId: `t5-safe-${repetition}` });
    const unsafe = executeDeterministicT5Control({ unsafe: true, objectiveId: `t5-unsafe-${repetition}` });
    assert.equal(safe.verdict, 'PASS', `safe repetition ${repetition}`);
    assert.equal(unsafe.verdict, 'FAIL', `unsafe repetition ${repetition}`);
  }
});
