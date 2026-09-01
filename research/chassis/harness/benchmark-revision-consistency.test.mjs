import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBenchmarkRepositoryRevisionConsistency } from './benchmark-promotion-gate.mjs';
import { benchmarkEligible } from './experiment-record-validator.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

const REVISION_A = '1'.repeat(40);
const REVISION_B = '2'.repeat(40);
const HARNESS_A = 'e'.repeat(64);
const HARNESS_B = '9'.repeat(64);

function qualificationRecord(candidate = 'Temporal TypeScript') {
  const value = currentLifecycleQualificationProvenance(candidate);
  return {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  };
}

function verifiedSupport(candidate = 'Temporal TypeScript') {
  const supportRevision = '3'.repeat(40);
  return {
    [candidate]: {
      preRunCleanup: true,
      postRunCleanup: true,
      status: 'RUNTIME_VERIFIED',
      verificationEvidence: {
        executionRef: `github-actions:run=lifecycle;job=qualification;sha=${supportRevision}`,
        repositoryRevision: supportRevision,
        experimentId: `${candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-t5-001`,
        mutantId: 'T5',
        repetition: 1,
        recordSha256: 'a'.repeat(64),
        validatorSha256: 'b'.repeat(64),
        harnessSha256: 'c'.repeat(64),
        lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate),
        verifiedAt: '2026-09-01T00:00:00.000Z'
      }
    }
  };
}

function t7Record(repetition, repositoryRevision, harnessSha256 = HARNESS_A, overrides = {}) {
  const workerPid = 7000 + repetition;
  return {
    schemaVersion: 1,
    experimentId: `temporal-typescript-t7-${String(repetition).padStart(3, '0')}`,
    candidate: 'Temporal TypeScript',
    mutantId: 'T7',
    repetition,
    randomSeed: 1070000 + repetition,
    setup: {
      status: 'READY',
      candidateVersion: '1.23.0',
      candidateSourceRef: 'temporalio/sdk-typescript v1.23.0',
      adapterSha256: 'd'.repeat(64),
      harnessSha256,
      dependencyIdentity: {
        manifestPath: '/fixture/research/chassis/adapters/temporal-ts/package.json',
        manifestSha256: '7'.repeat(64),
        packages: [{
          package: '@temporalio/worker',
          expectedVersion: '1.23.0',
          declaredVersion: '1.23.0',
          installedVersion: '1.23.0',
          installedPackageJson: '/fixture/node_modules/@temporalio/worker/package.json'
        }]
      },
      environment: {
        os: overrides.os ?? 'linux 6.11.0',
        arch: overrides.arch ?? 'x64',
        runtime: overrides.runtime ?? 'node v22.16.0',
        packageManager: null,
        repositoryProvenance: {
          source: 'git',
          status: 'VERIFIED',
          revision: repositoryRevision,
          trackedWorktreeClean: true,
          reason: null
        },
        formalPromotionPolicy: formalPromotionPolicyProvenance(),
        formalLifecycleQualification: qualificationRecord(),
        formalRuntimeLifecycle: { candidate: 'Temporal TypeScript', status: 'RUNTIME_VERIFIED' }
      },
      parameters: {
        randomSeed: 1070000 + repetition,
        mode: 'local-process',
        workerAuthorityBoundary: 'Temporal worker process'
      },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: {
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        cliSha256: '6'.repeat(64),
        versionOutput: overrides.versionOutput ?? 'Temporal CLI 1.8.1 Server 1.31.2',
        expectedProfile: {
          sdkVersion: '1.23.0', cliVersion: '1.8.1', serverVersion: '1.31.2', platform: 'linux', arch: 'x64'
        },
        observedPlatform: { platform: 'linux', arch: 'x64' },
        workspace: `/tmp/run-${repetition}`,
        address: `127.0.0.1:${7200 + repetition}`,
        serverPid: 90000 + repetition
      }
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: {
        intended: 'T7', injected: true, targetKind: 'worker-process', targetIdentity: workerPid,
        signal: 'SIGKILL', durableAuthorityAlive: true
      },
      rawObservations: { workerProcessPids: [workerPid], workerProcess: { pid: workerPid } },
      acceptanceChecks: { exactlyOnce: true }
    },
    cleanup: {
      status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
      observedWorkerPids: [workerPid], liveObservedWorkerPids: []
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'f'.repeat(64) }],
    verdict: 'PASS',
    blocker: null
  };
}

const t7Suite = {
  mutants: [{ id: 'T7', critical: true, minRepetitions: 2 }],
  benchmarkEligibility: { forbidBlockedOrInconclusive: ['T7'] }
};

test('candidate benchmark accepts repetitions from one frozen repository revision harness and environment identity even when lifecycle support was qualified earlier', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A)],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, true, result.errors.join('\n'));
  assert.equal(result.environmentConsistency.consistent, true);
});

test('candidate benchmark rejects repetitions mixed across repository revisions', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_B)],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /formal benchmark records span multiple Git repository revisions/);
});

test('candidate benchmark rejects repetitions with the same claimed repository revision but different harness identities', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A, HARNESS_A), t7Record(2, REVISION_A, HARNESS_B)],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /formal benchmark records span multiple harness identities/);
});

test('candidate benchmark rejects malformed harness identity rather than treating it as absent from consistency set', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A, 'not-a-sha'), t7Record(2, REVISION_A, 'not-a-sha')],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks a valid formal harness SHA-256 identity/);
});

test('candidate benchmark rejects same revision and harness when Node runtime changes', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A, HARNESS_A, { runtime: 'node v24.0.0' })],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /multiple common execution environment identities/);
});

test('candidate benchmark rejects same revision harness and Node when native runtime profile changes', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A, HARNESS_A, { versionOutput: 'Temporal CLI 1.8.1 Server 1.31.3' })],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /multiple candidate execution profile identities/);
});

test('cross-candidate comparison reports one common revision only when every verified record shares it', () => {
  const same = assessBenchmarkRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } },
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.deepEqual(same, {
    consistent: true,
    repositoryRevision: REVISION_A,
    repositoryRevisions: [REVISION_A],
    errors: []
  });

  const mixed = assessBenchmarkRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } },
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_B, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.equal(mixed.consistent, false);
  assert.equal(mixed.repositoryRevision, null);
  assert.deepEqual(mixed.repositoryRevisions, [REVISION_A, REVISION_B]);
  assert.match(mixed.errors.join('\n'), /benchmark comparison spans multiple Git repository revisions/);
});
