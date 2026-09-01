import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeVerificationEvidenceValid } from './formal-cleanup-support.mjs';
import { currentLifecycleQualificationSha256 } from './formal-lifecycle-qualification-provenance.mjs';
import { reviewLifecyclePromotion } from './formal-lifecycle-promotion-review.mjs';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';
import { readyFormalRecord, TEST_REPOSITORY_REVISION } from './formal-test-fixtures.mjs';

const HARNESS_SHA = 'a'.repeat(64);
const EXECUTION_REF = `github-actions:run=fixture;job=restate;sha=${TEST_REPOSITORY_REVISION}`;

function texts() {
  const record = readyFormalRecord({
    candidate: 'Restate',
    mutantId: 'T5',
    repetition: 1,
    harnessSha256: HARNESS_SHA,
    repositoryRevision: TEST_REPOSITORY_REVISION
  });
  record.setup.environment.formalRuntimeLifecycle.status = 'IMPLEMENTED_NOT_RUNTIME_VERIFIED';
  const validation = validateRuntimeLifecycleReceipt(record);
  return {
    record,
    validation,
    recordText: `${JSON.stringify(record, null, 2)}\n`,
    validationText: `${JSON.stringify(validation, null, 2)}\n`
  };
}

test('Restate lifecycle promotion review proposes support only when receipt, harness, qualification bundle and Git revision all match', () => {
  const { recordText, validationText, validation } = texts();
  assert.equal(validation.eligibleForLifecycleStatusPromotion, true, JSON.stringify(validation.checks, null, 2));
  const qualificationSha = currentLifecycleQualificationSha256('Restate');
  const result = reviewLifecyclePromotion({
    recordText,
    validationText,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: HARNESS_SHA,
    currentLifecycleQualificationSha256: qualificationSha,
    verifiedAt: '2026-09-01T00:00:02.000Z'
  });

  assert.equal(result.eligibleForSupportPromotion, true, JSON.stringify(result.checks, null, 2));
  assert.equal(result.proposedSupport.status, 'RUNTIME_VERIFIED');
  assert.equal(result.proposedSupport.preRunCleanup, true);
  assert.equal(result.proposedSupport.postRunCleanup, true);
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
  assert.equal(result.automaticRepositoryMutationAllowed, false);
  assert.equal(runtimeVerificationEvidenceValid(result.proposedSupport.verificationEvidence, 'Restate'), true);
});

test('Restate promotion review rejects a record whose native runtime version no longer matches frozen 1.7.8', () => {
  const { record, validation } = texts();
  record.setup.preRunCleanupReceipt.formalRuntimeIdentity.versionOutput = 'restate-server 1.8.0';
  const result = reviewLifecyclePromotion({
    recordText: `${JSON.stringify(record, null, 2)}\n`,
    validationText: `${JSON.stringify({ ...validation, eligibleForLifecycleStatusPromotion: true }, null, 2)}\n`,
    executionRef: EXECUTION_REF,
    currentHarnessSha256: HARNESS_SHA,
    currentLifecycleQualificationSha256: currentLifecycleQualificationSha256('Restate')
  });

  assert.equal(result.eligibleForSupportPromotion, false);
  assert.equal(result.checks.recomputedValidationEligible, false);
  assert.equal(result.proposedSupport, null);
});

test('Restate promotion review rejects stale lifecycle qualification identity', () => {
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
});
