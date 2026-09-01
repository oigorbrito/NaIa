import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeVerificationEvidenceValid } from './formal-cleanup-support.mjs';
import { reviewLifecyclePromotion } from './formal-lifecycle-promotion-review.mjs';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';

const HARNESS_SHA = 'b'.repeat(64);

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
  return reviewLifecyclePromotion({ currentHarnessSha256: HARNESS_SHA, ...args });
}

test('promotion review converts a valid T5/r1 lifecycle receipt with matching harness identity into support proposal only', () => {
  const { recordText, validationText } = texts();
  const result = review({
    recordText,
    validationText,
    executionRef: 'github-actions:run=123;job=temporal;sha=abc',
    verifiedAt: '2026-09-01T00:00:02.000Z'
  });
  assert.equal(result.eligibleForSupportPromotion, true);
  assert.equal(result.checks.currentHarnessSha256Valid, true);
  assert.equal(result.checks.recordHarnessMatchesCurrent, true);
  assert.equal(result.candidateSemanticVerdict, 'FAIL');
  assert.equal(result.candidateSemanticVerdictDoesNotControlLifecyclePromotion, true);
  assert.equal(result.proposedSupport.preRunCleanup, true);
  assert.equal(result.proposedSupport.postRunCleanup, true);
  assert.equal(result.proposedSupport.status, 'RUNTIME_VERIFIED');
  assert.equal(result.proposedSupport.verificationEvidence.harnessSha256, HARNESS_SHA);
  assert.equal(runtimeVerificationEvidenceValid(result.proposedSupport.verificationEvidence, 'Temporal TypeScript'), true);
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
  assert.equal(result.automaticRepositoryMutationAllowed, false);
});

test('promotion review rejects receipt produced by a different formal harness aggregate', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: 'github-actions:run=123;job=temporal;sha=abc',
    currentHarnessSha256: 'f'.repeat(64)
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recordHarnessMatchesCurrent, false);
  assert.equal(result.proposedSupport, null);
});

test('promotion review rejects missing or malformed current harness identity', () => {
  const { recordText, validationText } = texts();
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: 'github-actions:run=123;job=temporal;sha=abc',
    currentHarnessSha256: ''
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.currentHarnessSha256Valid, false);
});

test('promotion review rejects a supplied validator result whose candidate identity was altered', () => {
  const { recordText, validation } = texts();
  const tampered = { ...validation, candidate: 'DBOS TypeScript' };
  const result = review({
    recordText,
    validationText: `${JSON.stringify(tampered, null, 2)}\n`,
    executionRef: 'github-actions:run=123;job=temporal;sha=abc'
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
    executionRef: 'github-actions:run=123;job=temporal;sha=abc'
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
    executionRef: 'github-actions:run=123;job=temporal;sha=abc'
  });
  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recomputedValidationEligible, false);
});
