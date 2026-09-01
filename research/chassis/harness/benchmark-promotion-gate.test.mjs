import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessCandidatePromotion, FORMAL_PROMOTION_POLICY } from './benchmark-promotion-gate.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const critical = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'];

async function faultSuite() {
  return JSON.parse(await readFile(path.join(chassisRoot, 'fault-suite.v1.json'), 'utf8'));
}

function candidateSlug(candidate) {
  return candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function qualificationRecord(candidate) {
  const value = currentLifecycleQualificationProvenance(candidate);
  return value ? {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  } : null;
}

function verifiedCleanupSupport(candidate = 'Temporal TypeScript', experimentId = null) {
  return {
    [candidate]: {
      preRunCleanup: true,
      postRunCleanup: true,
      status: 'RUNTIME_VERIFIED',
      verificationEvidence: {
        executionRef: `test-fixture:${candidateSlug(candidate)}:runtime-receipt`,
        experimentId: experimentId ?? `${candidateSlug(candidate)}-t5-001`,
        mutantId: 'T5',
        repetition: 1,
        recordSha256: 'd'.repeat(64),
        validatorSha256: 'e'.repeat(64),
        harnessSha256: 'f'.repeat(64),
        lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate),
        verifiedAt: '2026-09-01T00:00:00.000Z'
      }
    }
  };
}

function record(candidate, mutantId, repetition, verdict = 'PASS') {
  const pass = verdict === 'PASS';
  const fail = verdict === 'FAIL';
  const workerPid = 500000 + critical.indexOf(mutantId) * 1000 + repetition;
  const slug = candidateSlug(candidate);
  const rawObservations = {
    workerProcessPids: [workerPid],
    workerA: { pid: workerPid }
  };
  if (mutantId === 'T16' && pass) {
    rawObservations.semanticMutation = { dimension: 'config', before: 'a', after: 'b' };
  }

  return {
    schemaVersion: 1,
    experimentId: `${slug}-${mutantId.toLowerCase()}-${String(repetition).padStart(3, '0')}`,
    candidate,
    mutantId,
    repetition,
    randomSeed: repetition,
    setup: {
      status: 'READY',
      candidateVersion: 'fixture',
      candidateSourceRef: 'fixture',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'f'.repeat(64),
      dependencyIdentity: null,
      environment: {
        os: 'fixture-os',
        arch: 'fixture-arch',
        runtime: 'node v22.16.0',
        formalPromotionPolicy: formalPromotionPolicyProvenance(),
        formalLifecycleQualification: qualificationRecord(candidate),
        formalRuntimeLifecycle: { candidate, status: 'RUNTIME_VERIFIED' }
      },
      parameters: {},
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
        intended: mutantId,
        injected: true,
        targetKind: 'worker-process',
        targetIdentity: workerPid,
        signal: mutantId === 'T7' ? 'SIGKILL' : null,
        durableAuthorityAlive: true
      },
      rawObservations,
      acceptanceChecks: pass ? { invariant: true } : fail ? { invariant: false } : { invariant: true }
    },
    cleanup: {
      status: 'PASS',
      workerCleanup: true,
      durableStateCleanup: true,
      oracleCleanup: true,
      temporaryResourcesCleanup: true,
      observedWorkerPids: [workerPid],
      liveObservedWorkerPids: []
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'c'.repeat(64) }],
    verdict,
    blocker: null
  };
}

function completeCandidate(candidate, verdictByMutant = {}) {
  const records = [];
  for (const mutantId of critical) {
    for (let repetition = 1; repetition <= 100; repetition += 1) {
      records.push(record(candidate, mutantId, repetition, verdictByMutant[mutantId] ?? 'PASS'));
    }
  }
  return records;
}

test('frozen promotion policy starts with no critical FAIL or PARTIAL exceptions', () => {
  assert.equal(FORMAL_PROMOTION_POLICY.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.deepEqual(FORMAL_PROMOTION_POLICY.acceptedCriticalFailures, {});
  assert.deepEqual(FORMAL_PROMOTION_POLICY.partialPolicies, {});
});

test('promotion stays closed without repository runtime-verified cleanup support', async () => {
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite());
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('complete all-PASS critical evidence is promotion-qualified only with candidate-bound verified cleanup support', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, true, result.errors.join('\n'));
  assert.equal(result.promotionPolicyStatus, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.deepEqual(result.exceptions, []);
});

test('cleanup support without harness hash cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.harnessSha256;
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('cleanup support without lifecycle qualification hash cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.lifecycleQualificationSha256;
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('tampering formal promotion policy provenance closes candidate comparability', async () => {
  const records = completeCandidate('Temporal TypeScript');
  records[0].setup.environment.formalPromotionPolicy.sha256 = '0'.repeat(64);
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /lacks current frozen formal promotion policy hash provenance/);
});

test('tampering lifecycle qualification provenance closes candidate comparability', async () => {
  const records = completeCandidate('Temporal TypeScript');
  records[0].setup.environment.formalLifecycleQualification.sha256 = '0'.repeat(64);
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /lacks current candidate lifecycle qualification bundle provenance/);
});

test('cleanup verification evidence from another candidate cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport('Temporal TypeScript', 'dbos-typescript-t5-001');
  const result = assessCandidatePromotion(completeCandidate('Temporal TypeScript'), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('critical FAIL evidence remains comparable but is not promotion-qualified without a preregistered exception', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  const result = assessCandidatePromotion(
    completeCandidate('Temporal TypeScript', { T7: 'FAIL' }),
    await faultSuite(),
    { cleanupSupport }
  );
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /T7: critical FAIL has no preregistered promotion exception/);
});

test('runtime acceptedFailures map cannot waive a critical FAIL after outcomes are observed', async () => {
  const suite = await faultSuite();
  const records = completeCandidate('Temporal TypeScript', { T7: 'FAIL' });
  const acceptedFailures = {
    'Temporal TypeScript': {
      T7: {
        enforced: true,
        constraint: 'forbid unsafe path',
        justification: 'post-result caller supplied policy'
      }
    }
  };
  const result = assessCandidatePromotion(records, suite, {
    acceptedFailures,
    cleanupSupport: verifiedCleanupSupport()
  });
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /runtime promotion policy overrides are non-authoritative/);
  assert.match(result.errors.join('\n'), /T7: critical FAIL has no preregistered promotion exception/);
});

test('runtime enforcedPolicies map cannot create a PARTIAL exception after outcomes are observed', async () => {
  const suite = await faultSuite();
  const records = completeCandidate('Temporal TypeScript', { T8: 'PARTIAL' });
  const enforcedPolicies = {
    'Temporal TypeScript': {
      T8: {
        enforced: true,
        constraint: 'force reconciliation',
        justification: 'post-result caller supplied policy'
      }
    }
  };
  const result = assessCandidatePromotion(records, suite, {
    enforcedPolicies,
    cleanupSupport: verifiedCleanupSupport()
  });
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /runtime promotion policy overrides are non-authoritative/);
  assert.match(result.errors.join('\n'), /T8: PARTIAL lacks a preregistered enforced promotion policy/);
});
