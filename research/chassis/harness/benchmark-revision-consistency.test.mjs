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

function t7Record(repetition, repositoryRevision) {
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
      candidateSourceRef: 'frozen',
      adapterSha256: 'd'.repeat(64),
      harnessSha256: 'e'.repeat(64),
      dependencyIdentity: {},
      environment: {
        os: 'linux',
        arch: 'x64',
        runtime: 'node v22.16.0',
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
      parameters: { randomSeed: 1070000 + repetition },
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

test('candidate benchmark accepts repetitions from one frozen repository revision even when lifecycle support was qualified on an earlier revision', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A)],
    t7Suite,
    verifiedSupport()
  );
  assert.equal(result.eligible, true, result.errors.join('\n'));
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
