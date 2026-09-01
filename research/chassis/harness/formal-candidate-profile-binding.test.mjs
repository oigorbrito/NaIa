import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessCandidateProfileBinding,
  candidateProfileRecordFields,
  currentCandidateProfileExpectation
} from './formal-candidate-profile-binding.mjs';

const CANDIDATES = [
  'Temporal TypeScript',
  'DBOS TypeScript',
  'Restate',
  'Trigger.dev'
];

function record(candidate = 'Temporal TypeScript') {
  const fields = candidateProfileRecordFields(candidate);
  return {
    candidate,
    setup: {
      status: 'READY',
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

test('all four preregistered candidates bind to their frozen capability and manifest identities', () => {
  for (const candidate of CANDIDATES) {
    const expected = currentCandidateProfileExpectation(candidate);
    assert.ok(expected, candidate);
    const result = assessCandidateProfileBinding(record(candidate));
    assert.equal(result.bound, true, `${candidate}: ${result.errors.join('\n')}`);
  }
});

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

test('current Restate record binding requires both frozen SDK packages', () => {
  const expected = currentCandidateProfileExpectation('Restate');
  assert.deepEqual(expected.packages.map((entry) => entry.package), [
    '@restatedev/restate-sdk',
    '@restatedev/restate-sdk-clients'
  ]);
  const result = assessCandidateProfileBinding(record('Restate'));
  assert.equal(result.bound, true, result.errors.join('\n'));
});

test('current Trigger.dev binding includes SDK build and CLI package identities', () => {
  const expected = currentCandidateProfileExpectation('Trigger.dev');
  assert.deepEqual(expected.packages.map((entry) => entry.package), [
    '@trigger.dev/build',
    '@trigger.dev/sdk',
    'trigger.dev'
  ]);
  const result = assessCandidateProfileBinding(record('Trigger.dev'));
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
  assert.match(result.errors.join('\n'), /record expected\/declared versions must both equal frozen version 4\.27\.6/);
  assert.match(result.errors.join('\n'), /READY record installedVersion must equal frozen version 4\.27\.6/);
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

test('blocked records may omit installed package version but cannot report a conflicting one', () => {
  const value = record('Restate');
  value.setup.status = 'BLOCKED_SETUP';
  for (const entry of value.setup.dependencyIdentity.packages) entry.installedVersion = null;
  let result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, true, result.errors.join('\n'));

  value.setup.dependencyIdentity.packages[0].installedVersion = '0.0.0';
  result = assessCandidateProfileBinding(value);
  assert.equal(result.bound, false);
  assert.match(result.errors.join('\n'), /blocked record installedVersion, when present, must equal frozen version/);
});
