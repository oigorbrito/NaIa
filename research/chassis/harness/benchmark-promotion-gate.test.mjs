import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessCandidatePromotion, FORMAL_PROMOTION_POLICY } from './benchmark-promotion-gate.mjs';
import {
  completeCandidateRecords,
  verifiedCleanupSupport as sharedVerifiedCleanupSupport
} from './formal-test-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REPOSITORY_REVISION = '1'.repeat(40);

async function faultSuite() {
  return JSON.parse(await readFile(path.join(chassisRoot, 'fault-suite.v1.json'), 'utf8'));
}

function verifiedCleanupSupport(candidate = 'Temporal TypeScript', experimentId = null) {
  const support = sharedVerifiedCleanupSupport([candidate], REPOSITORY_REVISION);
  if (experimentId !== null) support[candidate].verificationEvidence.experimentId = experimentId;
  return support;
}

function completeCandidate(candidate = 'Temporal TypeScript', verdictByMutant = {}) {
  return completeCandidateRecords(candidate, 100, verdictByMutant);
}

test('frozen promotion policy starts with no critical FAIL or PARTIAL exceptions', () => {
  assert.equal(FORMAL_PROMOTION_POLICY.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.deepEqual(FORMAL_PROMOTION_POLICY.acceptedCriticalFailures, {});
  assert.deepEqual(FORMAL_PROMOTION_POLICY.partialPolicies, {});
});

test('promotion stays closed without repository runtime-verified cleanup support', async () => {
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite());
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('complete all-PASS critical evidence is promotion-qualified only with candidate-bound Git-revision, qualified native-runtime cleanup support and stable environment identity', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, true, result.errors.join('\n'));
  assert.equal(result.qualified, true, result.errors.join('\n'));
  assert.equal(result.environmentConsistency.consistent, true);
  assert.equal(result.promotionPolicyStatus, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.deepEqual(result.exceptions, []);
});

test('candidate promotion rejects mixed Node runtime identities before selection', async () => {
  const records = completeCandidate();
  records[1].setup.environment.runtime = 'node v24.0.0';
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /multiple common execution environment identities/);
});

test('candidate promotion rejects native runtime profile drift before selection', async () => {
  const records = completeCandidate();
  records[1].setup.preRunCleanupReceipt.versionOutput = 'Temporal CLI 1.8.1 Server 1.31.3';
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity|multiple candidate execution profile identities/);
});

test('candidate promotion rejects a benchmark-wide native runtime that is internally stable but differs from the lifecycle qualification runtime', async () => {
  const records = completeCandidate();
  for (const record of records) record.setup.preRunCleanupReceipt.cliSha256 = '7'.repeat(64);
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.environmentConsistency.consistent, true, result.environmentConsistency.errors.join('\n'));
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
});

test('cleanup support without harness hash cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.harnessSha256;
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('cleanup support without lifecycle qualification hash cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.lifecycleQualificationSha256;
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('cleanup support without native runtime identity hash cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.runtimeIdentitySha256;
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('cleanup support without repository revision cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  delete cleanupSupport['Temporal TypeScript'].verificationEvidence.repositoryRevision;
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('cleanup support execution ref bound to another Git revision cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport();
  cleanupSupport['Temporal TypeScript'].verificationEvidence.executionRef = `github-actions:run=fixture;job=temporal;sha=${'2'.repeat(40)}`;
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('tampering Git repository provenance closes candidate comparability', async () => {
  const records = completeCandidate();
  records[0].setup.environment.repositoryProvenance.status = 'UNVERIFIED';
  records[0].setup.environment.repositoryProvenance.trackedWorktreeClean = false;
  records[0].setup.environment.repositoryProvenance.reason = 'TRACKED_WORKTREE_DIRTY';
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /lacks verified clean Git repository revision provenance/);
});

test('tampering formal promotion policy provenance closes candidate comparability', async () => {
  const records = completeCandidate();
  records[0].setup.environment.formalPromotionPolicy.sha256 = '0'.repeat(64);
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /lacks current frozen formal promotion policy hash provenance/);
});

test('tampering lifecycle qualification provenance closes candidate comparability', async () => {
  const records = completeCandidate();
  records[0].setup.environment.formalLifecycleQualification.sha256 = '0'.repeat(64);
  const result = assessCandidatePromotion(records, await faultSuite(), { cleanupSupport: verifiedCleanupSupport() });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /lacks current candidate lifecycle qualification bundle provenance/);
});

test('cleanup verification evidence from another candidate cannot open promotion', async () => {
  const cleanupSupport = verifiedCleanupSupport('Temporal TypeScript', 'dbos-typescript-t5-001');
  const result = assessCandidatePromotion(completeCandidate(), await faultSuite(), { cleanupSupport });
  assert.equal(result.comparable, false);
  assert.equal(result.qualified, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('critical FAIL evidence remains comparable but is not promotion-qualified without a preregistered exception', async () => {
  const result = assessCandidatePromotion(
    completeCandidate('Temporal TypeScript', { T7: 'FAIL' }),
    await faultSuite(),
    { cleanupSupport: verifiedCleanupSupport() }
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
