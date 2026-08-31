import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT11Control } from './t11-cancel-retry-control.mjs';
import { evaluateT11Evidence } from './t11-evaluator.mjs';

test('T11 evaluator accepts cancellation preserved across crash and recovery', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'PASS');
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.equal(evidence.postCancelProtectedOperation.acceptedCountAfterCancel, 0);
});

test('T11 evaluator rejects recovery that forgets durable cancellation', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: true });
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.postCancelBoundaryChallengedSafely, false);
  assert.equal(result.checks.zeroAcceptedProgressAfterCancel, false);
  assert.equal(result.checks.finalCancellationAuthoritative, false);
});

test('T11 evaluator fails closed without durable cancellation authority', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  evidence.cancelAuthority.durable = false;
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.cancelAuthorityDurable, false);
});

test('T11 evaluator fails closed when crash target identity is not the old worker', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  evidence.crash.targetIdentity = 'other-worker';
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.crashInjectedAfterCancelAuthority, false);
});

test('T11 evaluator admits native cancellation that causally blocks reaching protected operation', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  evidence.postCancelProtectedOperation = {
    attempted: false,
    blockedBeforeProtectedOperation: true,
    blockedByNativeCancellation: true,
    accepted: false,
    acceptedCountAfterCancel: 0
  };
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.checks.postCancelBoundaryChallengedSafely, true);
});

test('T11 evaluator rejects timeout-like non-progress without causal cancellation evidence', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  evidence.postCancelProtectedOperation = {
    attempted: false,
    blockedBeforeProtectedOperation: true,
    blockedByNativeCancellation: false,
    accepted: false,
    acceptedCountAfterCancel: 0
  };
  const result = evaluateT11Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.postCancelBoundaryChallengedSafely, false);
});
