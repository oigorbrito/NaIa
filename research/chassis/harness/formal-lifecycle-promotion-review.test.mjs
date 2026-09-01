import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeVerificationEvidenceValid } from './formal-cleanup-support.mjs';
import { currentLifecycleQualificationProvenance } from './formal-lifecycle-qualification-provenance.mjs';
import { reviewLifecyclePromotion } from './formal-lifecycle-promotion-review.mjs';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';

const HARNESS_SHA = 'b'.repeat(64);
const REPOSITORY_REVISION = '1'.repeat(40);
const EXECUTION_REF = `github-actions:run=123;job=temporal;sha=${REPOSITORY_REVISION}`;
const QUALIFICATION = currentLifecycleQualificationProvenance('Temporal TypeScript');
const QUALIFICATION_RECORD = Object.freeze({
  profile: QUALIFICATION.profile,
  candidate: QUALIFICATION.candidate,
  sha256: QUALIFICATION.aggregateSha256,
  fileCount: QUALIFICATION.fileCount
});

function temporalRecord() {
  return {
    schemaVersion: 1,
    experimentId: 'temporal-typescript-t5-001',
    candidate: 'Temporal TypeScript',
    mutantId: 'T5',
    repetition: 1,
    randomSeed: 1050001,
    setup: {
      status: 'READY',
      candidateVersion: '1.23.0',
      candidateSourceRef: 'frozen',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: HARNESS_SHA,
      dependencyIdentity: {},
      environment: {
        os: 'linux', arch: 'x64', runtime: 'node v22.16.0',
        repositoryProvenance: {
          source: 'git', status: 'VERIFIED', revision: REPOSITORY_REVISION,
          trackedWorktreeClean: true, reason: null
        },
        formalLifecycleQualification: { ...QUALIFICATION_RECORD },
        formalRuntimeLifecycle: { candidate: 'Temporal TypeScript', status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED' }
      },
      parameters: { randomSeed: 1050001 },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: {
        status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true
      }
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: {
        intended: 'T5', injected: true, targetKind: 'concurrent-worker-ownership-race',
        targetIdentity: 'worker-A', signal: null, durableAuthorityAlive: true
      },
      rawObservations: {
        workerProcessPids: [4101, 4102],
        t5Evidence: { rawNativeEvidence: { workerA: { pid: 4101 }, workerB: { pid: 4102 } } },
        runnerProcess: { pid: 4199, exitCode: 0 }
      },
      acceptanceChecks: { semanticAuthorityCheck: false }
    },
    cleanup: {
      status: 'PASS', workerCleanup: true, durableStateCleanup: true, oracleCleanup: true, temporaryResourcesCleanup: true,
      observedWorkerPids: [4101, 4102, 4199], liveObservedWorkerPids: [], temporalServerCleanup: true, sqliteCleanup: true, workspaceCleanup: true
    },
    artifacts: [{ name: 'observations.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'FAIL',
    blocker: null
  };
}

function texts() {
  const record = temporalRecord();
  const validation = validateRuntimeLifecycleReceipt(record);
  return {
    record,
    recordText: `${JSON.stringify(record, null, 2)}\n`,
    validation,
    validationText: `${JSON.stringify(validation, null, 2)}\n`
  };
}

function review(args) {
  return reviewLifecyclePromotion({
    currentHarnessSha256: HARNESS_SHA,
    currentLifecycleQualificationSha256: QUALIFICATION.aggregateSha256,
    ...args
  });
}

test('promotion review converts a valid T5/r1 lifecycle receipt with matching harness, candidate bundle and Git revision into support proposal only', () => {
  const { recordText, validationText } = texts();
  const result = review({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    verifiedAt: '2026-09-01T00:00:02.000Z'
  });
  assert.equal(result.eligibleForSupportPromotion, true);
  assert.equal(result.checks.executionRefRepositoryRevisionPresent, true);
  assert.equal(result.checks.recordRepositoryRevisionVerified, true);
  assert.equal(result.checks.executionRefRepositoryRevisionMatchesRecord, true);
  assert.equal(result.checks.currentHarnessSha256Valid, true);
  assert.equal(result.checks.recordHarnessMatchesCurrent, true);
  assert.equal(result.checks.currentLifecycleQualificationSha256Valid, true);
  assert.equal(result.checks.recordLifecycleQualificationMatchesCurrent, true);
  assert.equal(result.candidateSemanticVerdict, 'FAIL');
  assert.equal(result.candidateSemanticVerdictDoesNotControlLifecyclePromotion, true);
  assert.equal(result.proposedSupport.preRunCleanup, true);
  assert.equal(result.proposedSupport.postRunCleanup, true);
  assert.equal(result.proposedSupport.status, 'RUNTIME_VERIFIED');
  assert.equal(result.proposedSupport.verificationEvidence.repositoryRevision, REPOSITORY_REVISION);
  assert.equal(result.proposedSupport.verificationEvidence.harnessSha256, HARNESS_SHA);
  assert.equal(result.proposedSupport.verificationEvidence.lifecycleQualificationSha256, QUALIFICATION.aggregateSha256);
  assert.equal(runtimeVerificationEvidenceValid(result.proposedSupport.verificationEvidence, 'Temporal TypeScript'), true);
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
  assert.equal(result.automaticRepositoryMutationAllowed, false);
});

test('promotion review rejects execution ref whose Git revision differs from the record', () => {
  const { recordText, validationText } = texts();
  const result = review({
    recordText,
    validationText,
    executionRef: `github-actions:run=123;job=temporal;sha=${'2'.repeat(40)}`
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.executionRefRepositoryRevisionMatchesRecord, false);
  assert.equal(result.proposedSupport, null);
});

test('promotion review rejects receipt produced by a different formal harness aggregate', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: 'f'.repeat(64),
    currentLifecycleQualificationSha256: QUALIFICATION.aggregateSha256
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recordHarnessMatchesCurrent, false);
  assert.equal(result.proposedSupport, null);
});

test('promotion review rejects stale candidate lifecycle qualification bundle', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: HARNESS_SHA,
    currentLifecycleQualificationSha256: 'f'.repeat(64)
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recordLifecycleQualificationMatchesCurrent, false);
  assert.equal(result.proposedSupport, null);
});

test('promotion review rejects missing or malformed current harness identity', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: '',
    currentLifecycleQualificationSha256: QUALIFICATION.aggregateSha256
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.currentHarnessSha256Valid, false);
});

test('promotion review rejects missing candidate qualification identity', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: HARNESS_SHA,
    currentLifecycleQualificationSha256: ''
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.currentLifecycleQualificationSha256Valid, false);
});

test('promotion review rejects a supplied validator result whose candidate identity was altered', () => {
  const { recordText, validation } = texts();
  const tampered = { ...validation, candidate: 'DBOS TypeScript' };
  const result = review({
    recordText,
    validationText: `${JSON.stringify(tampered, null, 2)}\n`,
    executionRef: EXECUTION_REF
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.candidateMatches, false);
  assert.equal(result.proposedSupport, null);
});

test('promotion review rejects missing immutable execution reference', () => {
  const { recordText, validationText } = texts();
  const result = review({ recordText, validationText, executionRef: '' });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.executionRefPresent, false);
});

test('promotion review recomputes lifecycle receipt validity instead of trusting an eligible flag', () => {
  const { record, validation } = texts();
  record.cleanup.liveObservedWorkerPids = [4102];
  const forgedValidation = { ...validation, eligibleForLifecycleStatusPromotion: true };
  const result = review({
    recordText: `${JSON.stringify(record, null, 2)}\n`,
    validationText: `${JSON.stringify(forgedValidation, null, 2)}\n`,
    executionRef: EXECUTION_REF
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recomputedValidationEligible, false);
});

test('promotion review rejects driver-only provenance even if supplied validation claims eligibility', () => {
  const { record, validation } = texts();
  record.run.rawObservations.workerProcessPids = [];
  const forgedValidation = { ...validation, eligibleForLifecycleStatusPromotion: true };
  const result = review({
    recordText: `${JSON.stringify(record, null, 2)}\n`,
    validationText: `${JSON.stringify(forgedValidation, null, 2)}\n`,
    executionRef: EXECUTION_REF
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recomputedValidationEligible, false);
});
