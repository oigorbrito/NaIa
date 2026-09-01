import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkEligible } from './experiment-record-validator.mjs';
import { formalLedgerAdmission } from './experiment-ledger-validator.mjs';
import { candidateProfileRecordFields } from './formal-candidate-profile-binding.mjs';
import { deriveFormalEnvironmentIdentity } from './formal-environment-identity.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

const REPOSITORY_REVISION = '1'.repeat(40);

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
  tamperLifecycleQualification = false,
  tamperCandidateProfile = false,
  tamperRuntimeIdentity = false,
  repositoryVerified = true,
  missingDependencyIdentity = false
} = {}) {
  const profile = candidateProfileRecordFields('Temporal TypeScript');
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
      candidateVersion: tamperCandidateProfile ? '9.9.9' : profile.candidateVersion,
      candidateSourceRef: tamperCandidateProfile ? 'invented/source v9.9.9' : profile.candidateSourceRef,
      adapterSha256: profile.adapterSha256,
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: missingDependencyIdentity ? null : {
        manifestPath: '/fixture/research/chassis/adapters/temporal-ts/package.json',
        manifestSha256: profile.manifestSha256,
        packages: profile.packages.map((entry) => ({
          ...entry,
          installedPackageJson: `/fixture/node_modules/${entry.package}/package.json`
        }))
      },
      environment: {
        os: 'linux 6.11.0',
        arch: 'x64',
        runtime: 'node v22.16.0',
        packageManager: null,
        repositoryProvenance: repositoryVerified
          ? {
              source: 'git', status: 'VERIFIED', revision: REPOSITORY_REVISION,
              trackedWorktreeClean: true, reason: null
            }
          : {
              source: 'git', status: 'UNVERIFIED', revision: REPOSITORY_REVISION,
              trackedWorktreeClean: false, reason: 'TRACKED_WORKTREE_DIRTY'
            },
        formalPromotionPolicy: promotionPolicy,
        formalLifecycleQualification: qualification,
        formalRuntimeLifecycle: {
          candidate: 'Temporal TypeScript',
          status: lifecycleStatus
        }
      },
      parameters: {
        randomSeed: 1,
        mode: profile.mode,
        workerAuthorityBoundary: profile.workerAuthorityBoundary
      },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: {
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        cliSha256: tamperRuntimeIdentity ? '7'.repeat(64) : '6'.repeat(64),
        versionOutput: 'Temporal CLI 1.8.1 Server 1.31.2',
        expectedProfile: {
          sdkVersion: '1.23.0', cliVersion: '1.8.1', serverVersion: '1.31.2', platform: 'linux', arch: 'x64'
        },
        observedPlatform: { platform: 'linux', arch: 'x64' },
        workspace: '/tmp/fixture',
        address: '127.0.0.1:7233',
        serverPid: 123
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

const QUALIFIED_RUNTIME_IDENTITY_SHA256 = deriveFormalEnvironmentIdentity(
  record({ lifecycleStatus: 'RUNTIME_VERIFIED' })
).runtimeIdentitySha256;

const verificationEvidence = {
  executionRef: `github-actions:run=fixture;job=temporal;sha=${REPOSITORY_REVISION}`,
  repositoryRevision: REPOSITORY_REVISION,
  experimentId: 'temporal-typescript-t5-001',
  mutantId: 'T5',
  repetition: 1,
  recordSha256: 'd'.repeat(64),
  validatorSha256: 'e'.repeat(64),
  harnessSha256: 'b'.repeat(64),
  lifecycleQualificationSha256: currentLifecycleQualificationSha256('Temporal TypeScript'),
  runtimeIdentitySha256: QUALIFIED_RUNTIME_IDENTITY_SHA256,
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

test('formal ledger admission rejects cleanup support whose execution ref is bound to a different Git revision', () => {
  const support = structuredClone(verifiedSupport);
  support['Temporal TypeScript'].verificationEvidence.executionRef = `github-actions:run=fixture;job=temporal;sha=${'2'.repeat(40)}`;
  const result = formalLedgerAdmission(record({ lifecycleStatus: 'RUNTIME_VERIFIED' }), support);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /cleanup support is not runtime-verified/);
});

test('formal ledger admission requires verified clean Git provenance for READY formal execution', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', repositoryVerified: false }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /READY stored formal record requires verified clean Git repository revision provenance/);
});

test('formal ledger admission rejects READY record without complete candidate environment identity', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', missingDependencyIdentity: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /dependencyIdentity\.manifestSha256|installed formal dependency set/);
});

test('formal ledger admission rejects a READY record that is internally consistent but outside the current frozen candidate profile', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperCandidateProfile: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /candidate profile differs from current frozen candidate profile/);
  assert.match(result.errors.join('\n'), /candidateVersion mismatch/);
  assert.match(result.errors.join('\n'), /candidateSourceRef differs/);
});

test('formal ledger admission rejects READY runtime identity drift from the lifecycle qualification runtime', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperRuntimeIdentity: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
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
  assert.match(result.errors.join('\n'), /promotion policy differs from current frozen promotion policy/);
});

test('formal ledger admission rejects record bound to a stale lifecycle qualification bundle', () => {
  const result = formalLedgerAdmission(
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperLifecycleQualification: true }),
    verifiedSupport
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /lifecycle qualification bundle differs from current qualification bundle/);
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

test('formal ledger admission opens only when lifecycle, Git revision, candidate profile, environment identity, qualified native runtime identity, current lifecycle bundle, policy hash, worker PID binding and evidence-backed cleanup support are verified', () => {
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

test('benchmark eligibility rejects READY runtime identity drift from the lifecycle qualification runtime', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([
    record({ lifecycleStatus: 'RUNTIME_VERIFIED', tamperRuntimeIdentity: true })
  ], faultSuite, verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
});

test('benchmark eligibility accepts the same valid critical record only after Git revision, candidate profile, environment identity, qualified native runtime identity, lifecycle bundle, policy hash, worker PID binding and support evidence are runtime-verified', () => {
  const faultSuite = {
    mutants: [{ id: 'T5', minRepetitions: 1 }],
    benchmarkEligibility: { forbidBlockedOrInconclusive: ['T5'] }
  };
  const result = benchmarkEligible([record({ lifecycleStatus: 'RUNTIME_VERIFIED' })], faultSuite, verifiedSupport);
  assert.equal(result.eligible, true, result.errors.join('\n'));
  assert.equal(result.candidate, 'Temporal TypeScript');
  assert.equal(result.environmentConsistency.consistent, true);
  assert.deepEqual(result.errors, []);
});
