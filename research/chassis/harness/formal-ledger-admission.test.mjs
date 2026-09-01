import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkEligible } from './experiment-record-validator.mjs';
import { formalLedgerAdmission } from './experiment-ledger-validator.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

function qualificationRecord(candidate = 'Temporal TypeScript') {
  const value = currentLifecycleQualificationProvenance(candidate);
  return value ? {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  } : null;
}

function record({
  lifecycleStatus = 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
  cleanupStatus = 'PASS',
  withWorkerPid = true,
  driverOnly = false,
  omitWorkerFromCleanup = false,
  liveWorker = false,
  tamperPromotionPolicy = false,
  tamperLifecycleQualification = false
} = {}) {
  const workerPid = 7701;
  const driverPid = 7799;
  const rawObservations = driverOnly
    ? { runnerProcess: { pid: driverPid } }
    : withWorkerPid
      ? { workerProcessPids: [workerPid], workerA: { pid: workerPid }, runnerProcess: { pid: driverPid } }
      : {};
  const observedWorkerPids = omitWorkerFromCleanup
    ? [driverPid]
    : withWorkerPid && !driverOnly
      ? [workerPid, driverPid]
      : driverOnly
        ? [driverPid]
        : [];
  const promotionPolicy = formalPromotionPolicyProvenance();
  if (tamperPromotionPolicy) promotionPolicy.sha256 = '0'.repeat(64);
  const qualification = qualificationRecord();
  if (tamperLifecycleQualification && qualification) qualification.sha256 = '0'.repeat(64);
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
        formalPromotionPolicy: promotionPolicy,
        formalLifecycleQualification: qualification,
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
      rawObservations,
      acceptanceChecks: { ownershipFenced: true }
    },
    cleanup: {
      status: cleanupStatus,
      workerCleanup: cleanupStatus === 'PASS',
      durableStateCleanup: cleanupStatus === 'PASS',
      oracleCleanup: cleanupStatus === 'PASS',
      temporaryResourcesCleanup: cleanupStatus === 'PASS',
      observedWorkerPids,
      liveObservedWorkerPids: liveWorker ? [workerPid] : []
    },
    artifacts: [{ name: 'evidence.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'PASS',
    blocker: null
  };
}

const verificationEvidence = {
  executionRef: 'test-fixture:runtime-receipt',
  experimentId: 'temporal-typescript-t5-001',
  mutantId: 'T5',
  repetition: 1,
  recordSha256: 'd'.repeat(64),
  validatorSha256: 'e'.repeat(64),
  harnessSha256: 'b'.repeat(64),
  lifecycleQualificationSha256: currentLifecycleQualificationSha256('Temporal TypeScript'),
  verifiedAt: '2026-09-01T00:00:02.000Z'
};

const verifiedSupport = {
  'Temporal TypeScript': {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence
  }
};

const booleanOnlySupport = {
  'Temporal TypeScript': {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: null
  }
};

const unverifiedSupport = {
  'Temporal TypeScript': {
    preRunCleanup: false,
    postRunCleanup: false,
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: null
  }
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

test('formal ledger admission rejects boolean-only cleanup promotion without receipt hashes', () => {
  const result = formalLedgerAdmission(record({ lifecycleStatus: 'RUNTIME_VERIFIED' }), booleanOnlySupport);
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

test('formal ledger admission rejects record bound to a different promotion policy hash', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperPromotionPolicy: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /lacks current frozen promotion policy hash provenance/);
});

test('formal ledger admission rejects record bound to a stale lifecycle qualification bundle', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperLifecycleQualification: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /lacks current candidate lifecycle qualification bundle provenance/);
});

test('formal ledger admission rejects injected critical execution with zero explicit worker process PIDs', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', withWorkerPid: false }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /lacks explicit worker process PID provenance/);
});

test('formal ledger admission rejects driver PID as a substitute for worker PID provenance', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', driverOnly: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /lacks explicit worker process PID provenance/);
});

test('formal ledger admission rejects explicit worker PID omitted from cleanup observation', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', omitWorkerFromCleanup: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /cleanup evidence omitted explicit worker process PIDs: 7701/);
});

test('formal ledger admission rejects explicit worker PID reported alive after cleanup', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', liveWorker: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /still alive: 7701/);
});

test('formal ledger admission opens only when lifecycle, current lifecycle bundle, policy hash, worker PID binding and evidence-backed cleanup support are verified', () => {
  const result = formalLedgerAdmission(record({ lifecycleStatus: 'RUNTIME_VERIFIED' }), verifiedSupport);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('benchmark eligibility rejects pilot records lacking verified formal lifecycle provenance', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([record()], faultSuite, verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /RUNTIME_VERIFIED/);
});

test('benchmark eligibility accepts the same valid critical record only after lifecycle bundle, policy hash, worker PID binding and support evidence are runtime-verified', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([record({ lifecycleStatus: 'RUNTIME_VERIFIED' })], faultSuite, verifiedSupport);
  assert.deepEqual(result, { eligible: true, candidate: 'Temporal TypeScript', errors: [] });
});
