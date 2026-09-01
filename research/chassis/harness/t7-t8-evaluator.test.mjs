import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateT7T8Semantics } from './t7-t8-evaluator.mjs';

function observation(overrides = {}) {
  return {
    totalApplyCount: 1,
    totalResponseLossCount: 0,
    relatedOperationCount: 1,
    durableAuthorityReachable: true,
    terminalEvent: 'objective_completed',
    finalStatus: 'COMPLETED',
    measurementCutoffReached: false,
    ...overrides
  };
}

test('T7 accepts the frozen completed exactly-once contract without candidate identity', () => {
  const result = evaluateT7T8Semantics('T7', observation());
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    responseLossNotInjected: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});

test('T8 accepts the frozen completed exactly-once contract after response loss', () => {
  const result = evaluateT7T8Semantics('T8', observation({ totalResponseLossCount: 1 }));
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    measurementCutoffNotReached: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});

test('RECONCILIATION_REQUIRED is observable safe state but not T7 or T8 PASS under the frozen executable slice', () => {
  for (const mutantId of ['T7', 'T8']) {
    const result = evaluateT7T8Semantics(mutantId, observation({
      totalResponseLossCount: mutantId === 'T8' ? 1 : 0,
      terminalEvent: 'reconciliation_required',
      finalStatus: 'RECONCILIATION_REQUIRED'
    }));
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.equal(result.passed, false);
    assert.equal(result.checks.recoveredToCompletion, false);
    assert.equal(result.checks.finalStatusCompleted, false);
  }
});

test('semantic evaluation is independent of fault injection bookkeeping', () => {
  const value = observation();
  value.crashInjected = false;
  value.responseLossInjected = false;
  value.candidate = 'candidate-specific-label-must-not-matter';
  value.checks = { finalStatusCompleted: false };
  assert.equal(evaluateT7T8Semantics('T7', value).passed, true);
});

test('each stable semantic invariant can independently close PASS', () => {
  const variants = [
    { totalApplyCount: 2 },
    { relatedOperationCount: 2 },
    { durableAuthorityReachable: false },
    { terminalEvent: 'fatal_error' },
    { finalStatus: 'FAILED' }
  ];
  for (const override of variants) {
    assert.equal(evaluateT7T8Semantics('T7', observation(override)).passed, false);
  }
  assert.equal(evaluateT7T8Semantics('T7', observation({ totalResponseLossCount: 1 })).passed, false);
  assert.equal(evaluateT7T8Semantics('T8', observation({ totalResponseLossCount: 1, measurementCutoffReached: true })).passed, false);
});

test('incomplete raw observations fail closed rather than manufacturing acceptance checks', () => {
  const result = evaluateT7T8Semantics('T7', { totalApplyCount: 1 });
  assert.equal(result.valid, false);
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks, {});
  assert.match(result.errors.join('\n'), /durableAuthorityReachable must be boolean/);
});
