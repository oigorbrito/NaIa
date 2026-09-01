import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveFormalEnvironmentIdentity } from './formal-environment-identity.mjs';
import { readyFormalRecord } from './formal-test-fixtures.mjs';

function record() {
  return readyFormalRecord({ candidate: 'Restate', mutantId: 'T5', repetition: 1 });
}

test('Restate READY record requires frozen 1.7.8 native runtime identity', () => {
  const identity = deriveFormalEnvironmentIdentity(record());
  assert.equal(identity.valid, true, identity.errors.join('\n'));
  assert.equal(identity.candidateProfile.runtimeIdentity.kind, 'restate-local-server-runtime');
  assert.equal(identity.candidateProfile.runtimeIdentity.expectedProfile.serverVersion, '1.7.8');
  assert.match(identity.candidateProfile.runtimeIdentity.serverSha256, /^[a-f0-9]{64}$/);
});

test('Restate binary SHA drift changes candidate profile identity', () => {
  const a = record();
  const b = record();
  b.setup.preRunCleanupReceipt.formalRuntimeIdentity.serverSha256 = 'f'.repeat(64);
  const first = deriveFormalEnvironmentIdentity(a);
  const second = deriveFormalEnvironmentIdentity(b);
  assert.equal(first.valid, true, first.errors.join('\n'));
  assert.equal(second.valid, true, second.errors.join('\n'));
  assert.notEqual(first.candidateProfileSha256, second.candidateProfileSha256);
});

test('Restate runtime version drift is rejected before formal admission', () => {
  const value = record();
  value.setup.preRunCleanupReceipt.formalRuntimeIdentity.versionOutput = 'restate-server 1.8.0';
  value.setup.preRunCleanupReceipt.formalRuntimeIdentity.expectedProfile.serverVersion = '1.8.0';
  const identity = deriveFormalEnvironmentIdentity(value);
  assert.equal(identity.valid, false);
  assert.match(identity.errors.join('\n'), /frozen server version 1\.7\.8|expectedProfile must match frozen server 1\.7\.8/);
});

test('Restate missing observed executable SHA is rejected rather than treated as equivalent', () => {
  const value = record();
  value.setup.preRunCleanupReceipt.formalRuntimeIdentity.serverSha256 = null;
  const identity = deriveFormalEnvironmentIdentity(value);
  assert.equal(identity.valid, false);
  assert.match(identity.errors.join('\n'), /serverSha256/);
});

test('dynamic Restate workspace ports and process IDs stay outside candidate profile identity', () => {
  const a = record();
  const b = record();
  b.setup.preRunCleanupReceipt.workspace = '/tmp/another-restate-run';
  b.setup.preRunCleanupReceipt.adminUrl = 'http://127.0.0.1:35001';
  b.setup.preRunCleanupReceipt.ingressUrl = 'http://127.0.0.1:35002';
  b.setup.preRunCleanupReceipt.serverPid = 99999;
  const first = deriveFormalEnvironmentIdentity(a);
  const second = deriveFormalEnvironmentIdentity(b);
  assert.equal(first.valid, true, first.errors.join('\n'));
  assert.equal(second.valid, true, second.errors.join('\n'));
  assert.equal(first.candidateProfileSha256, second.candidateProfileSha256);
});
