import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import {
  appendRecordToLedger,
  assessStoredFormalLedgerHarnessConsistency,
  assessStoredFormalLedgerRepositoryRevisionConsistency
} from './experiment-ledger-validator.mjs';
import { currentLifecycleQualificationProvenance } from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';
import { verifiedCleanupSupport } from './formal-test-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REVISION_A = '1'.repeat(40);
const REVISION_B = '2'.repeat(40);
const HARNESS_A = 'e'.repeat(64);
const HARNESS_B = '9'.repeat(64);

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
  return verifiedCleanupSupport([candidate], supportRevision)[candidate];
}

function blockedRecord(spec, repositoryRevision, harnessSha256 = HARNESS_A) {
  return {
    schemaVersion: 1,
    experimentId: spec.experimentId,
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    randomSeed: spec.randomSeed,
    setup: {
      status: 'BLOCKED_SETUP',
      candidateVersion: 'fixture-version',
      candidateSourceRef: 'fixture-source',
      adapterSha256: 'd'.repeat(64),
      harnessSha256,
      dependencyIdentity: null,
      environment: {
        os: 'linux',
        arch: 'x64',
        runtime: 'node v22.16.0',
        repositoryProvenance: {
          source: 'git', status: 'VERIFIED', revision: repositoryRevision,
          trackedWorktreeClean: true, reason: null
        },
        formalPromotionPolicy: formalPromotionPolicyProvenance(),
        formalLifecycleQualification: qualificationRecord(spec.candidate),
        formalRuntimeLifecycle: { candidate: spec.candidate, status: 'RUNTIME_VERIFIED' }
      },
      parameters: { randomSeed: spec.randomSeed },
      cleanupVerifiedBeforeRun: false,
      preRunCleanupReceipt: null
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: { intended: spec.mutantId, injected: false },
      rawObservations: { setupBlocked: true },
      acceptanceChecks: {}
    },
    cleanup: {
      status: 'NOT_APPLICABLE',
      workerCleanup: true,
      durableStateCleanup: true,
      oracleCleanup: true,
      temporaryResourcesCleanup: true,
      observedWorkerPids: [],
      liveObservedWorkerPids: []
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'f'.repeat(64) }],
    verdict: 'BLOCKED',
    blocker: 'DEPENDENCY_NOT_INSTALLED'
  };
}

test('formal ledger revision consistency treats one verified revision as a continuable prefix and mixed revisions as a separate-series boundary', () => {
  const one = assessStoredFormalLedgerRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.equal(one.consistent, true);
  assert.equal(one.repositoryRevision, REVISION_A);

  const mixed = assessStoredFormalLedgerRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } },
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_B, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.equal(mixed.consistent, false);
  assert.deepEqual(mixed.repositoryRevisions, [REVISION_A, REVISION_B]);
  assert.match(mixed.errors.join('\n'), /formal ledger prefix spans multiple Git repository revisions/);
});

test('formal ledger harness consistency treats one SHA as a continuable prefix and mixed harness identities as a separate-series boundary', () => {
  const one = assessStoredFormalLedgerHarnessConsistency([
    { setup: { harnessSha256: HARNESS_A } },
    { setup: { harnessSha256: HARNESS_A } }
  ]);
  assert.equal(one.consistent, true);
  assert.equal(one.harnessSha256, HARNESS_A);

  const mixed = assessStoredFormalLedgerHarnessConsistency([
    { setup: { harnessSha256: HARNESS_A } },
    { setup: { harnessSha256: HARNESS_B } }
  ]);
  assert.equal(mixed.consistent, false);
  assert.deepEqual(mixed.harnessSha256s, [HARNESS_B, HARNESS_A].sort());
  assert.match(mixed.errors.join('\n'), /formal ledger prefix spans multiple harness identities/);
});

test('formal append rejects the next preregistered record when it would cross the frozen repository revision', async () => {
  const [protocol, faultSuite] = await Promise.all([
    json('experiment-protocol.v1.json'),
    json('fault-suite.v1.json')
  ]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  assert.equal(plan[0].candidate, 'Temporal TypeScript');
  assert.equal(plan[0].mutantId, 'T5');
  assert.equal(plan[1].candidate, 'DBOS TypeScript');
  assert.equal(plan[1].mutantId, 'T5');

  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '3'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '4'.repeat(40))
  };

  const first = appendRecordToLedger(
    [],
    blockedRecord(plan[0], REVISION_A),
    protocol,
    faultSuite,
    { cleanupSupport }
  );
  assert.equal(first.repositoryRevisionConsistency.consistent, true);
  assert.equal(first.repositoryRevisionConsistency.repositoryRevision, REVISION_A);

  assert.throws(
    () => appendRecordToLedger(
      first.records,
      blockedRecord(plan[1], REVISION_B),
      protocol,
      faultSuite,
      { cleanupSupport }
    ),
    /appended formal ledger would mix repository revisions/
  );
});

test('formal append rejects the next preregistered record when it would cross the frozen harness identity even under the same Git revision claim', async () => {
  const [protocol, faultSuite] = await Promise.all([
    json('experiment-protocol.v1.json'),
    json('fault-suite.v1.json')
  ]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  const cleanupSupport = {
    'Temporal TypeScript': supportEntry('Temporal TypeScript', '3'.repeat(40)),
    'DBOS TypeScript': supportEntry('DBOS TypeScript', '4'.repeat(40))
  };

  const first = appendRecordToLedger(
    [],
    blockedRecord(plan[0], REVISION_A, HARNESS_A),
    protocol,
    faultSuite,
    { cleanupSupport }
  );
  assert.equal(first.harnessConsistency.consistent, true);
  assert.equal(first.harnessConsistency.harnessSha256, HARNESS_A);

  assert.throws(
    () => appendRecordToLedger(
      first.records,
      blockedRecord(plan[1], REVISION_A, HARNESS_B),
      protocol,
      faultSuite,
      { cleanupSupport }
    ),
    /appended formal ledger would mix harness identities/
  );
});
