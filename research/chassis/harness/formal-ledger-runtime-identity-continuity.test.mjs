import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessStoredFormalLedgerCurrentCompatibility,
  assessStoredFormalRecordCurrentCompatibility
} from './experiment-ledger-validator.mjs';
import {
  TEST_REPOSITORY_REVISION,
  readyFormalRecord,
  verifiedCleanupSupport
} from './formal-test-fixtures.mjs';

const candidate = 'Temporal TypeScript';

function qualifiedRecord() {
  return readyFormalRecord({
    candidate,
    mutantId: 'T5',
    repetition: 1,
    repositoryRevision: TEST_REPOSITORY_REVISION
  });
}

function currentSupport() {
  return verifiedCleanupSupport([candidate], TEST_REPOSITORY_REVISION);
}

test('stored READY record remains current-compatible only while lifecycle runtime qualification identity is unchanged', () => {
  const record = qualifiedRecord();
  const support = currentSupport();

  const before = assessStoredFormalRecordCurrentCompatibility(record, support);
  assert.equal(before.compatible, true, before.errors.join('\n'));

  const rotatedSupport = structuredClone(support);
  rotatedSupport[candidate].verificationEvidence.runtimeIdentitySha256 = 'f'.repeat(64);

  const after = assessStoredFormalRecordCurrentCompatibility(record, rotatedSupport);
  assert.equal(after.compatible, false);
  assert.match(after.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
});

test('stored formal ledger prefix cannot continue after lifecycle runtime qualification identity rotates', () => {
  const record = qualifiedRecord();
  const support = currentSupport();

  const before = assessStoredFormalLedgerCurrentCompatibility([record], support);
  assert.equal(before.compatible, true, before.errors.join('\n'));

  const rotatedSupport = structuredClone(support);
  rotatedSupport[candidate].verificationEvidence.runtimeIdentitySha256 = 'f'.repeat(64);

  const after = assessStoredFormalLedgerCurrentCompatibility([record], rotatedSupport);
  assert.equal(after.compatible, false);
  assert.match(after.errors.join('\n'), /ledger index 0/);
  assert.match(after.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
});
