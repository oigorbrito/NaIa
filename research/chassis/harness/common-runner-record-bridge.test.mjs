import assert from 'node:assert/strict';
import test from 'node:test';
import { commonRunnerEvidenceToRunResult } from './common-runner-record-bridge.mjs';

function evidence(mutant, overrides = {}) {
  return {
    mutant,
    mode: 'local-process',
    verdict: 'PASS',
    objectiveId: 'objective-1',
    operationId: 'objective-1:external-effect',
    blocker: null,
    initial: { pid: 1234, signal: mutant === 'T7' ? 'SIGKILL' : null },
    checks: {
      crashInjected: mutant === 'T7',
      responseLossInjected: mutant === 'T8',
      resumedToCompletion: true,
      expectedOperationApplied: true,
      noIdentityDrift: true,
      noDuplicateExternalEffect: true,
      oneResponseLossObserved: mutant === 'T8',
      noUnexpectedResponseLoss: mutant === 'T7',
      finalStatusCompleted: true
    },
    mutants: {
      T7_process_sigkill: mutant === 'T7' ? 'PASS' : 'NOT_EXECUTED',
      T8_response_loss: mutant === 'T8' ? 'PASS' : 'NOT_EXECUTED'
    },
    ...overrides
  };
}

test('bridge maps isolated T7 to worker-process fault without T8 acceptance leakage', () => {
  const result = commonRunnerEvidenceToRunResult(evidence('T7'), 'T7');
  assert.equal(result.blocked, false);
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.targetKind, 'worker-process');
  assert.equal(result.fault.signal, 'SIGKILL');
  assert.equal(result.acceptanceChecks.noUnexpectedResponseLoss, true);
  assert.equal('oneResponseLossObserved' in result.acceptanceChecks, false);
});

test('bridge maps isolated T8 to response-loss fault without process crash requirement', () => {
  const result = commonRunnerEvidenceToRunResult(evidence('T8'), 'T8');
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.targetKind, 'external-response');
  assert.equal(result.fault.signal, null);
  assert.equal(result.acceptanceChecks.oneResponseLossObserved, true);
});

test('bridge preserves runtime prerequisite BLOCKED classification', () => {
  const value = evidence('T8', { verdict: 'BLOCKED', blocker: 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT' });
  value.checks.responseLossInjected = false;
  const result = commonRunnerEvidenceToRunResult(value, 'T8');
  assert.equal(result.blocked, true);
  assert.equal(result.blocker, 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT');
  assert.equal(result.fault.injected, false);
});

test('managed-controller T7 cannot be converted into injected worker fault', () => {
  const value = evidence('T7', {
    mode: 'managed-controller',
    verdict: 'INCONCLUSIVE',
    mutants: { T7_worker_sigkill: 'NOT_EXECUTED' }
  });
  const result = commonRunnerEvidenceToRunResult(value, 'T7');
  assert.equal(result.fault.injected, false);
  assert.equal(result.fault.targetKind, 'worker-process-unaddressed');
});

test('bridge rejects evidence from a different mutant', () => {
  assert.throws(() => commonRunnerEvidenceToRunResult(evidence('T8'), 'T7'), /mutant mismatch/);
});
