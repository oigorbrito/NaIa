import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';

function baseCleanup(candidate) {
  const shared = {
    status: 'PASS',
    workerCleanup: true,
    durableStateCleanup: true,
    oracleCleanup: true,
    temporaryResourcesCleanup: true,
    observedWorkerPids: [4101, 4102],
    liveObservedWorkerPids: [],
    workspaceCleanup: true
  };
  if (candidate === 'Temporal TypeScript') {
    return {
      ...shared,
      temporalServerCleanup: true,
      sqliteCleanup: true
    };
  }
  return {
    ...shared,
    cleanupContainerAllowed: true,
    databaseDrop: true,
    databaseAbsent: true,
    postgresContainerCleanup: true
  };
}

function makeRecord(candidate, overrides = {}) {
  const preRunCleanupReceipt = {
    status: 'PASS',
    workerCleanup: true,
    durableStateCleanup: true,
    oracleCleanup: true,
    temporaryResourcesCleanup: true,
    evidenceId: `${candidate}:runtime-receipt`
  };
  const record = {
    schemaVersion: 1,
    experimentId: candidate === 'Temporal TypeScript' ? 'temporal-typescript-t5-001' : 'dbos-typescript-t5-001',
    candidate,
    mutantId: 'T5',
    repetition: 1,
    randomSeed: candidate === 'Temporal TypeScript' ? 1050001 : 2050001,
    setup: {
      status: 'READY',
      candidateVersion: candidate === 'Temporal TypeScript' ? '1.23.0' : '4.27.6',
      candidateSourceRef: 'frozen-source-ref',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: {},
      environment: {
        os: 'linux',
        arch: 'x64',
        runtime: 'node v22.16.0',
        formalRuntimeLifecycle: {
          candidate,
          status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED'
        }
      },
      parameters: { randomSeed: candidate === 'Temporal TypeScript' ? 1050001 : 2050001 },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: { experimentId: 'qualification' },
      fault: {
        intended: 'T5',
        injected: true,
        targetKind: 'worker-process',
        targetIdentity: 4101,
        signal: 'SIGKILL',
        durableAuthorityAlive: true
      },
      rawObservations: { runnerProcess: { exitCode: 0, timedOut: false } },
      acceptanceChecks: { semanticAuthorityCheck: false }
    },
    cleanup: baseCleanup(candidate),
    artifacts: [{ name: 'experiment-observations.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'FAIL',
    blocker: null
  };
  return {
    ...record,
    ...overrides,
    setup: { ...record.setup, ...(overrides.setup ?? {}) },
    run: { ...record.run, ...(overrides.run ?? {}) },
    cleanup: { ...record.cleanup, ...(overrides.cleanup ?? {}) }
  };
}

test('Temporal T5 runtime receipt can qualify lifecycle even when candidate semantic verdict is FAIL', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript'));
  assert.equal(result.valid, true);
  assert.equal(result.candidateVerdict, 'FAIL');
  assert.equal(result.candidateVerdictIgnoredForLifecycleVerification, true);
  assert.equal(result.eligibleForLifecycleStatusPromotion, true);
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
});

test('DBOS T5 runtime receipt can qualify lifecycle independently of candidate semantic verdict', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('DBOS TypeScript'));
  assert.equal(result.valid, true);
  assert.equal(result.eligibleForLifecycleStatusPromotion, true);
  assert.equal(result.checks.databaseAbsent, true);
  assert.equal(result.checks.postgresContainerCleanup, true);
});

test('runtime lifecycle receipt rejects vacuous worker cleanup without observed worker PIDs', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    cleanup: { observedWorkerPids: [] }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.observedWorkerPidsPresent, false);
});

test('runtime lifecycle receipt rejects any observed worker still alive after cleanup', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('DBOS TypeScript', {
    cleanup: { liveObservedWorkerPids: [4102] }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.noObservedWorkerPidAliveAfterCleanup, false);
});

test('runtime lifecycle receipt rejects non-PASS cleanup for a READY execution', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    cleanup: { status: 'NOT_APPLICABLE' }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.cleanupPass, false);
});

test('runtime lifecycle receipt is pinned to T5 repetition 1 rather than a post-hoc convenient mutant', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    mutantId: 'T7',
    experimentId: 'temporal-typescript-t7-001',
    run: { fault: { intended: 'T7', injected: true, targetKind: 'worker-process', targetIdentity: 4101, signal: 'SIGKILL', durableAuthorityAlive: true } }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.firstPreregisteredMutant, false);
});
