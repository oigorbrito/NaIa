import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExperimentRecord, benchmarkEligible } from './experiment-record-validator.mjs';

function record() {
  return {
    schemaVersion: 1,
    experimentId: 'exp-1',
    candidate: 'Temporal TypeScript',
    mutantId: 'T7',
    repetition: 1,
    setup: {
      status: 'READY', candidateVersion: '1.23.0', adapterSha256: 'aaaaaaaaaaaaaaaa', harnessSha256: 'bbbbbbbbbbbbbbbb',
      environment: { os: 'linux', arch: 'x64', runtime: 'node 22' }, parameters: {}, cleanupVerifiedBeforeRun: true
    },
    run: {
      startedAt: '2026-08-31T15:00:00Z', finishedAt: '2026-08-31T15:00:02Z', workload: {},
      fault: { intended: 'process termination after effect', injected: true, targetKind: 'worker-process', targetIdentity: 1234, signal: 'SIGKILL', durableAuthorityAlive: true },
      rawObservations: {}, acceptanceChecks: { noDuplicate: true, recoveryObserved: true }
    },
    cleanup: { status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true },
    artifacts: [{ name: 'raw.json', sha256: 'dddddddddddddddd' }], verdict: 'PASS'
  };
}

test('accepts an executed critical PASS with provenance', () => {
  const result = validateExperimentRecord(record());
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('setup blocker cannot be candidate FAIL', () => {
  const value = record(); value.setup.status = 'BLOCKED_SETUP'; value.setup.cleanupVerifiedBeforeRun = false; value.verdict = 'FAIL';
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /BLOCKED_SETUP must yield BLOCKED/);
});

test('missing fault injection cannot become PASS', () => {
  const value = record(); value.run.fault.injected = false;
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /INCONCLUSIVE/);
});

test('FAIL requires an observed failed acceptance check', () => {
  const value = record(); value.verdict = 'FAIL'; value.run.acceptanceChecks.noDuplicate = false;
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('benchmark eligibility rejects missing required mutant records', () => {
  const result = benchmarkEligible([record()], { benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5', 'T7'] } });
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /T5: no executed records/);
});
