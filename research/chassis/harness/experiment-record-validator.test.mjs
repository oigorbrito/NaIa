import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExperimentRecord, benchmarkEligible } from './experiment-record-validator.mjs';

const verifiedSupport = {
  'Temporal TypeScript': {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: {
      executionRef: 'test-fixture:runtime-receipt',
      experimentId: 'temporal-typescript-t5-001',
      mutantId: 'T5',
      repetition: 1,
      recordSha256: 'e'.repeat(64),
      validatorSha256: 'f'.repeat(64),
      verifiedAt: '2026-09-01T00:00:00.000Z'
    }
  }
};

function record(overrides = {}) {
  const mutantId = overrides.mutantId ?? 'T7';
  const rawObservations = overrides.withPid === false ? {} : { workerProcess: { pid: overrides.pid ?? 8801 } };
  if (mutantId === 'T16') {
    rawObservations.semanticMutation = { dimension: 'runtimeVersion', before: 'v1', after: 'v2' };
  }

  return {
    schemaVersion: 1,
    experimentId: overrides.experimentId ?? 'exp-1',
    candidate: overrides.candidate ?? 'Temporal TypeScript',
    mutantId,
    repetition: overrides.repetition ?? 1,
    randomSeed: overrides.randomSeed ?? 1001,
    setup: {
      status: 'READY', candidateVersion: '1.23.0', adapterSha256: 'aaaaaaaaaaaaaaaa', harnessSha256: 'bbbbbbbbbbbbbbbb',
      environment: {
        os: 'linux', arch: 'x64', runtime: 'node 22',
        formalRuntimeLifecycle: { candidate: overrides.candidate ?? 'Temporal TypeScript', status: 'RUNTIME_VERIFIED' }
      },
      parameters: {}, cleanupVerifiedBeforeRun: true
    },
    run: {
      startedAt: '2026-08-31T15:00:00Z', finishedAt: '2026-08-31T15:00:02Z', workload: {},
      fault: { intended: 'process termination after effect', injected: true, targetKind: 'worker-process', targetIdentity: 1234, signal: 'SIGKILL', durableAuthorityAlive: true },
      rawObservations,
      acceptanceChecks: { noDuplicate: true, recoveryObserved: true }
    },
    cleanup: { status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true },
    artifacts: [{ name: 'raw.json', sha256: 'dddddddddddddddd' }], verdict: 'PASS'
  };
}

function suite(minRepetitions = 100, required = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16']) {
  return {
    mutants: required.map((id) => ({ id, critical: true, minRepetitions })),
    benchmarkEligibility: { forbidBlockedOrInconclusive: required }
  };
}

function completeRecords(minRepetitions = 100) {
  const required = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];
  return required.flatMap((mutantId) => Array.from({ length: minRepetitions }, (_, index) => record({
    experimentId: `${mutantId}-${index + 1}`,
    mutantId,
    repetition: index + 1,
    randomSeed: 100000 + index + 1,
    pid: 9000 + index + 1
  })));
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

test('random seed must be a reproducible non-negative integer when supplied', () => {
  const value = record(); value.randomSeed = -1;
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /randomSeed/);
});

test('benchmark eligibility rejects missing required mutant records', () => {
  const result = benchmarkEligible([record()], suite(1, ['T5', 'T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /T5: no executed records/);
});

test('benchmark eligibility enforces declared minimum unique repetitions', () => {
  const records = completeRecords(99);
  const result = benchmarkEligible(records, suite(100), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /requires at least 100 unique repetitions, found 99/);
  assert.match(result.errors.join('\n'), /missing required repetition 100/);
});

test('benchmark eligibility rejects duplicate repetitions presented as replication', () => {
  const records = completeRecords(100);
  records.push(record({ experimentId: 'duplicate-T7-1', mutantId: 'T7', repetition: 1, randomSeed: 999999, pid: 9999 }));
  const result = benchmarkEligible(records, suite(100), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /T7: duplicate repetition 1/);
});

test('benchmark eligibility rejects injected critical record without observed PID provenance', () => {
  const result = benchmarkEligible(
    [record({ mutantId: 'T7', withPid: false })],
    suite(1, ['T7']),
    verifiedSupport
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks observed process PID provenance/);
});

test('benchmark eligibility remains closed when support booleans are true but receipt evidence is missing', () => {
  const booleanOnlySupport = {
    'Temporal TypeScript': { preRunCleanup: true, postRunCleanup: true, status: 'RUNTIME_VERIFIED', verificationEvidence: null }
  };
  const result = benchmarkEligible(completeRecords(1), suite(1), booleanOnlySupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility accepts complete critical coverage only with evidence-backed cleanup support and PID provenance', () => {
  const result = benchmarkEligible(completeRecords(100), suite(100), verifiedSupport);
  assert.equal(result.eligible, true, result.errors.join('\n'));
});
