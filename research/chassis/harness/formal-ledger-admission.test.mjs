import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkEligible } from './experiment-record-validator.mjs';
import { formalLedgerAdmission } from './experiment-ledger-validator.mjs';

function record({ lifecycleStatus = 'IMPLEMENTED_NOT_RUNTIME_VERIFIED', cleanupStatus = 'PASS' } = {}) {
  return {
    schemaVersion: 1,
    experimentId: 'temporal-typescript-t5-001',
    candidate: 'Temporal TypeScript',
    mutantId: 'T5',
    repetition: 1,
    randomSeed: 1,
    setup: {
      status: 'READY',
      candidateVersion: '1.23.0',
      candidateSourceRef: null,
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: null,
      environment: {
        os: 'linux',
        arch: 'x64',
        runtime: 'node v22.16.0',
        formalRuntimeLifecycle: {
          candidate: 'Temporal TypeScript',
          status: lifecycleStatus
        }
      },
      parameters: { randomSeed: 1 },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: {
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true
      }
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: {
        intended: 'T5',
        injected: true,
        targetKind: 'concurrent-worker-ownership-race',
        targetIdentity: 'worker-A',
        signal: null,
        durableAuthorityAlive: true
      },
      rawObservations: {},
      acceptanceChecks: { ownershipFenced: true }
    },
    cleanup: {
      status: cleanupStatus,
      workerCleanup: cleanupStatus === 'PASS',
      durableStateCleanup: cleanupStatus === 'PASS',
      oracleCleanup: cleanupStatus === 'PASS',
      temporaryResourcesCleanup: cleanupStatus === 'PASS'
    },
    artifacts: [{ name: 'evidence.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'PASS',
    blocker: null
  };
}

const verifiedSupport = {
  'Temporal TypeScript': { preRunCleanup: true, postRunCleanup: true }
};

const unverifiedSupport = {
  'Temporal TypeScript': { preRunCleanup: false, postRunCleanup: false }
};

test('formal ledger admission rejects implemented-but-unverified lifecycle even with clean receipt', () => {
  const result = formalLedgerAdmission(record(), verifiedSupport);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /RUNTIME_VERIFIED/);
});

test('formal ledger admission rejects runtime-verified lifecycle while cleanup support remains closed', () => {
  const result = formalLedgerAdmission(record({ lifecycleStatus: 'RUNTIME_VERIFIED' }), unverifiedSupport);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /cleanup support is not runtime-verified/);
});

test('formal ledger admission requires PASS cleanup for READY formal execution', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', cleanupStatus: 'NOT_APPLICABLE' }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /cleanup.status=PASS/);
});

test('formal ledger admission opens only when lifecycle provenance and cleanup support are verified', () => {
  const result = formalLedgerAdmission(record({ lifecycleStatus: 'RUNTIME_VERIFIED' }), verifiedSupport);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('benchmark eligibility rejects pilot records lacking verified formal lifecycle provenance', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([record()], faultSuite);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /RUNTIME_VERIFIED/);
});

test('benchmark eligibility accepts the same valid critical record after lifecycle provenance is runtime-verified', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([record({ lifecycleStatus: 'RUNTIME_VERIFIED' })], faultSuite);
  assert.deepEqual(result, { eligible: true, candidate: 'Temporal TypeScript', errors: [] });
});
