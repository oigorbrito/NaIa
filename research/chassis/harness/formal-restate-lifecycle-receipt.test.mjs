import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';
import { readyFormalRecord } from './formal-test-fixtures.mjs';

function record() {
  return readyFormalRecord({ candidate: 'Restate', mutantId: 'T5', repetition: 1 });
}

test('Restate T5/r1 receipt can qualify only for separate lifecycle promotion review', () => {
  const result = validateRuntimeLifecycleReceipt(record());
  assert.equal(result.valid, true, result.schemaErrors.join('\n'));
  assert.equal(result.eligibleForLifecycleStatusPromotion, true, JSON.stringify(result.checks, null, 2));
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
  assert.equal(result.checks.restateServerCleanup, true);
  assert.equal(result.checks.workspaceCleanup, true);
  assert.equal(result.formalEnvironmentIdentity.candidateProfile.runtimeIdentity.kind, 'restate-local-server-runtime');
});

test('Restate lifecycle receipt fails closed if server cleanup is not proven', () => {
  const value = record();
  value.cleanup.restateServerCleanup = false;
  const result = validateRuntimeLifecycleReceipt(value);
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.restateServerCleanup, false);
});

test('Restate lifecycle receipt fails closed if workspace cleanup is not proven', () => {
  const value = record();
  value.cleanup.workspaceCleanup = false;
  const result = validateRuntimeLifecycleReceipt(value);
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.workspaceCleanup, false);
});

test('Restate lifecycle receipt rejects a different server version through formal environment identity', () => {
  const value = record();
  value.setup.preRunCleanupReceipt.formalRuntimeIdentity.versionOutput = 'restate-server 1.8.0';
  const result = validateRuntimeLifecycleReceipt(value);
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.formalEnvironmentIdentityValid, false);
});
