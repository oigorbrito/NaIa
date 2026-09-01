import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCandidateProfileBinding,
  candidateProfileRecordFields,
  currentCandidateProfileExpectation
} from './formal-candidate-profile-binding.mjs';

function record(candidate = 'Temporal TypeScript') {
  const fields = candidateProfileRecordFields(candidate);
  return {
    candidate,
    setup: {
      candidateVersion: fields.candidateVersion,
      candidateSourceRef: fields.candidateSourceRef,
      adapterSha256: fields.adapterSha256,
      dependencyIdentity: {
        manifestSha256: fields.manifestSha256,
        packages: fields.packages.map((entry) => ({ ...entry }))
      },
      parameters: {
        mode: fields.mode,
        workerAuthorityBoundary: fields.workerAuthorityBoundary
      }
    }
  };
}

test('current Temporal record binding requires all four frozen execution packages', () => {
  const expected = currentCandidateProfileExpectation('Temporal TypeScript');
  assert.deepEqual(expected.packages.map((entry) => entry.package), [
    '@temporalio/activity',
    '@temporalio/client',
    '@temporalio/worker',
    '@temporalio/workflow'
  ]);
  assert.equal(assessCandidateProfileBinding(record()).bound, true);
});

test('current DBOS record binding requires the exact SDK package and current adapter/manifest bytes', () => {
  const expected = currentCandidateProfileExpectation('DBOS TypeScript');
  assert.deepEqual(expected.packages.map((entry) => entry.package), ['@dbos-inc/dbos-sdk']);
  const result = assessCandidateProfileBinding(record('DBOS TypeScript'));
  assert.equal(result.bound, true, result.errors.join('\n'));
});

test('self-consistent wrong candidate version or source ref does not bind to frozen candidate', () => {
  const value = record();
  value.setup.candidateVersion = '9.9.9';
  value.setup.candidateSourceRef = 'invented/source v9.9.9';
  const result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /candidateVersion mismatch/);
  assert.match(result.errors.join('\n'), /candidateSourceRef differs/);
});

test('fabricated adapter or package manifest hashes do not bind even when internally well formed', () => {
  const value = record();
  value.setup.adapterSha256 = '0'.repeat(64);
  value.setup.dependencyIdentity.manifestSha256 = '1'.repeat(64);
  const result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /adapterSha256 differs/);
  assert.match(result.errors.join('\n'), /manifestSha256 differs/);
});

test('missing or extra execution package cannot masquerade as frozen candidate profile', () => {
  const missing = record();
  missing.setup.dependencyIdentity.packages = missing.setup.dependencyIdentity.packages.slice(1);
  let result = assessCandidateProfileBinding(missing);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /formal dependency set mismatch/);

  const extra = record('DBOS TypeScript');
  extra.setup.dependencyIdentity.packages.push({
    package: '@example/extra', expectedVersion: '1.0.0', declaredVersion: '1.0.0', installedVersion: '1.0.0'
  });
  result = assessCandidateProfileBinding(extra);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /formal dependency set mismatch/);
});

test('installed version drift cannot bind to frozen candidate even if record expected version is edited to match the drift', () => {
  const value = record('DBOS TypeScript');
  value.setup.dependencyIdentity.packages[0].expectedVersion = '4.28.0';
  value.setup.dependencyIdentity.packages[0].declaredVersion = '4.28.0';
  value.setup.dependencyIdentity.packages[0].installedVersion = '4.28.0';
  const result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /must all equal frozen version 4\.27\.6/);
});

test('mode and worker authority boundary are bound to frozen capability matrix', () => {
  const value = record();
  value.setup.parameters.mode = 'managed-controller';
  value.setup.parameters.workerAuthorityBoundary = 'fabricated authority';
  const result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /execution mode mismatch/);
  assert.match(result.errors.join('\n'), /workerAuthorityBoundary differs/);
});
