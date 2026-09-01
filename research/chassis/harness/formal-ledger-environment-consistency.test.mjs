import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import { appendRecordToLedger } from './experiment-ledger-validator.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REVISION = '1'.repeat(40);
const HARNESS = 'a'.repeat(64);

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function qualificationRecord(candidate) {
  const value = currentLifecycleQualificationProvenance(candidate);
  return {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  };
}

function supportEntry(candidate, supportRevision) {
  const slug = candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: {
      executionRef: `github-actions:run=lifecycle;job=${slug};sha=${supportRevision}`,
      repositoryRevision: supportRevision,
      experimentId: `${slug}-t5-001`,
      mutantId: 'T5',
      repetition: 1,
      recordSha256: 'b'.repeat(64),
      validatorSha256: 'c'.repeat(64),
      harnessSha256: 'd'.repeat(64),
      lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate),
      verifiedAt: '2026-09-01T00:00:00.000Z'
    }
  };
}

function commonSetup(spec, runtime) {
  return {
    status: 'READY',
    harnessSha256: HARNESS,
    environment: {
      os: 'linux 6.11.0',
      arch: 'x64',
      runtime,
      packageManager: null,
      repositoryProvenance: {
        source: 'git', status: 'VERIFIED', revision: REVISION,
        trackedWorktreeClean: true, reason: null
      },
      formalPromotionPolicy: formalPromotionPolicyProvenance(),
      formalLifecycleQualification: qualificationRecord(spec.candidate),
      formalRuntimeLifecycle: { candidate: spec.candidate, status: 'RUNTIME_VERIFIED' }
    },
    cleanupVerifiedBeforeRun: true
  };
}

function temporalRecord(spec, runtime = 'node v22.16.0') {
  const pid = 8101;
  return {
    schemaVersion: 1,
    experimentId: spec.experimentId,
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    randomSeed: spec.randomSeed,
    setup: {
      ...commonSetup(spec, runtime),
      candidateVersion: '1.23.0',
      candidateSourceRef: 'temporalio/sdk-typescript v1.23.0',
      adapterSha256: 'e'.repeat(64),
      dependencyIdentity: {
        manifestSha256: 'f'.repeat(64),
        packages: [{
          package: '@temporalio/worker', expectedVersion: '1.23.0', declaredVersion: '1.23.0', installedVersion: '1.23.0'
        }]
      },
      parameters: { randomSeed: spec.randomSeed, mode: 'local-process', workerAuthorityBoundary: 'Temporal worker process' },
      preRunCleanupReceipt: {
        status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
        cliSha256: '1'.repeat(64), versionOutput: 'Temporal CLI 1.8.1 Server 1.31.2',
        expectedProfile: { sdkVersion: '1.23.0', cliVersion: '1.8.1', serverVersion: '1.31.2', platform: 'linux', arch: 'x64' },
        observedPlatform: { platform: 'linux', arch: 'x64' }, workspace: '/tmp/t', address: '127.0.0.1:7233', serverPid: 123
      }
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:00:01.000Z', blocked: false, blocker: null,
      workload: {}, fault: { intended: 'T5', injected: true, targetKind: 'concurrent-worker-ownership-race', targetIdentity: 't', signal: null, durableAuthorityAlive: true },
      rawObservations: { workerProcessPids: [pid], workerA: { pid } }, acceptanceChecks: { ownershipFenced: true }
    },
    cleanup: { status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true, observedWorkerPids: [pid], liveObservedWorkerPids: [] },
    artifacts: [{ name: 'fixture.json', path: null, sha256: '2'.repeat(64) }], verdict: 'PASS', blocker: null
  };
}

function dbosRecord(spec, runtime = 'node v22.16.0') {
  const pid = 8201;
  return {
    schemaVersion: 1,
    experimentId: spec.experimentId,
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    randomSeed: spec.randomSeed,
    setup: {
      ...commonSetup(spec, runtime),
      candidateVersion: '4.27.6',
      candidateSourceRef: 'dbos-inc/dbos-transact-ts v4.27',
      adapterSha256: '3'.repeat(64),
      dependencyIdentity: {
        manifestSha256: '4'.repeat(64),
        packages: [{
          package: '@dbos-inc/dbos-sdk', expectedVersion: '4.27.6', declaredVersion: '4.27.6', installedVersion: '4.27.6'
        }]
      },
      parameters: { randomSeed: spec.randomSeed, mode: 'local-process', workerAuthorityBoundary: 'DBOS executor process' },
      preRunCleanupReceipt: {
        status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
        dockerVersion: 'Docker version 28.0.0',
        postgresImage: 'postgres:16.10-alpine@sha256:' + '5'.repeat(64),
        postgresImageIdentity: 'postgres@sha256:' + '5'.repeat(64) + ' sha256:' + '6'.repeat(64),
        observedPlatform: { platform: 'linux', arch: 'x64' }, workspace: '/tmp/d', containerId: 'dynamic-id'
      }
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:00:01.000Z', blocked: false, blocker: null,
      workload: {}, fault: { intended: 'T5', injected: true, targetKind: 'concurrent-worker-ownership-race', targetIdentity: 'd', signal: null, durableAuthorityAlive: true },
      rawObservations: { workerProcessPids: [pid], workerA: { pid } }, acceptanceChecks: { ownershipFenced: true }
    },
    cleanup: { status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true, observedWorkerPids: [pid], liveObservedWorkerPids: [] },
    artifacts: [{ name: 'fixture.json', path: null, sha256: '7'.repeat(64) }], verdict: 'PASS', blocker: null
  };
}

test('formal append accepts different candidate profiles only when the common runtime environment stays frozen', async () => {
  const [protocol, faultSuite] = await Promise.all([json('experiment-protocol.v1.json'), json('fault-suite.v1.json')]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  assert.equal(plan[0].candidate, 'Temporal TypeScript');
  assert.equal(plan[1].candidate, 'DBOS TypeScript');
  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '8'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '9'.repeat(40))
  };

  const first = appendRecordToLedger([], temporalRecord(plan[0]), protocol, faultSuite, { cleanupSupport });
  const second = appendRecordToLedger(first.records, dbosRecord(plan[1]), protocol, faultSuite, { cleanupSupport });
  assert.equal(second.environmentConsistency.consistent, true, second.environmentConsistency.errors.join('\n'));
  assert.equal(second.environmentConsistency.commonEnvironmentSha256s.length, 1);
  assert.equal(second.environmentConsistency.candidateProfiles['Temporal TypeScript'].length, 1);
  assert.equal(second.environmentConsistency.candidateProfiles['DBOS TypeScript'].length, 1);
});

test('formal append rejects the next preregistered candidate when Node runtime would cross the frozen common environment identity', async () => {
  const [protocol, faultSuite] = await Promise.all([json('experiment-protocol.v1.json'), json('fault-suite.v1.json')]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '8'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '9'.repeat(40))
  };
  const first = appendRecordToLedger([], temporalRecord(plan[0]), protocol, faultSuite, { cleanupSupport });

  assert.throws(
    () => appendRecordToLedger(first.records, dbosRecord(plan[1], 'node v24.0.0'), protocol, faultSuite, { cleanupSupport }),
    /appended formal ledger would mix environment identities/
  );
});
