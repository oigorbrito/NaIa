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
    initial: {
      pid: 1234,
      signal: mutant === 'T7' ? 'SIGKILL' : null,
      timedOut: false,
      terminalEvent: mutant === 'T8' ? { event: 'objective_completed' } : null
    },
    resume: mutant === 'T7'
      ? { pid: 1235, terminalEvent: { event: 'objective_completed' } }
      : { pid: null, skipped: true },
    status: { process: { code: 0, pid: 1299 }, parsed: { state: 'COMPLETED' } },
    oracle: {
      operations: [{ operationId: 'objective-1:external-effect', applyCount: 1 }],
      totalApplyCount: 1,
      totalResponseLossCount: mutant === 'T8' ? 1 : 0
    },
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

test('bridge maps isolated T7 to worker-process fault and uses neutral semantic checks', () => {
  const result = commonRunnerEvidenceToRunResult(evidence('T7'), 'T7');
  assert.equal(result.blocked, false);
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.targetKind, 'worker-process');
  assert.equal(result.fault.signal, 'SIGKILL');
  assert.equal(result.fault.durableAuthorityAlive, true);
  assert.deepEqual(result.rawObservations.workerProcessPids, [1234, 1235]);
  assert.equal(result.rawObservations.semanticEvaluationValid, true);
  assert.deepEqual(result.acceptanceChecks, {
    responseLossNotInjected: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});

test('bridge maps isolated T8 to response-loss fault and uses the same neutral evaluator authority', () => {
  const result = commonRunnerEvidenceToRunResult(evidence('T8'), 'T8');
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.targetKind, 'external-response');
  assert.equal(result.fault.signal, null);
  assert.equal(result.fault.durableAuthorityAlive, true);
  assert.deepEqual(result.rawObservations.workerProcessPids, [1234]);
  assert.equal(result.rawObservations.workerProcessPids.includes(1299), false);
  assert.deepEqual(result.acceptanceChecks, {
    measurementCutoffNotReached: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});

test('tampered precomputed checks cannot manufacture formal PASS semantics', () => {
  const value = evidence('T8');
  value.checks = {
    responseLossInjected: true,
    resumedToCompletion: true,
    expectedOperationApplied: true,
    noIdentityDrift: true,
    noDuplicateExternalEffect: true,
    finalStatusCompleted: true
  };
  value.oracle.totalApplyCount = 2;
  value.oracle.operations[0].applyCount = 2;
  const result = commonRunnerEvidenceToRunResult(value, 'T8');
  assert.equal(result.fault.injected, true);
  assert.equal(result.acceptanceChecks.exactlyOneExternalApply, false);
});

test('RECONCILIATION_REQUIRED cannot be upgraded to formal T7 PASS by legacy runner checks', () => {
  const value = evidence('T7');
  value.resume.terminalEvent = { event: 'reconciliation_required' };
  value.status.parsed.state = 'RECONCILIATION_REQUIRED';
  value.checks.resumedToCompletion = true;
  value.checks.finalStatusCompleted = true;
  const result = commonRunnerEvidenceToRunResult(value, 'T7');
  assert.equal(result.acceptanceChecks.recoveredToCompletion, false);
  assert.equal(result.acceptanceChecks.finalStatusCompleted, false);
});

test('bridge preserves runtime prerequisite BLOCKED classification', () => {
  const value = evidence('T8', { verdict: 'BLOCKED', blocker: 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT' });
  value.checks.responseLossInjected = false;
  value.status = { process: { code: 1, pid: 1299 }, parsed: null };
  const result = commonRunnerEvidenceToRunResult(value, 'T8');
  assert.equal(result.blocked, true);
  assert.equal(result.blocker, 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT');
  assert.equal(result.fault.injected, false);
  assert.equal(result.fault.durableAuthorityAlive, false);
  assert.equal(result.rawObservations.semanticEvaluationValid, true);
  assert.equal(result.acceptanceChecks.durableAuthorityReachable, false);
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
