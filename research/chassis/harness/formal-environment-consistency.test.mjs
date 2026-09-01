import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFormalEnvironmentConsistency,
  formalCandidateRuntimeFingerprint,
  formalExecutionEnvironmentFingerprint
} from './formal-environment-consistency.mjs';

function record({
  candidate = 'Temporal TypeScript',
  os = 'linux 6.11',
  arch = 'x64',
  runtime = 'node v22.16.0',
  candidateVersion = '1.23.0',
  candidateSourceRef = 'temporalio/sdk-typescript v1.23.0',
  adapterSha256 = 'a'.repeat(64),
  manifestSha256 = 'b'.repeat(64),
  installedVersion = '1.23.0',
  installedPackageJson = '/tmp/location/node_modules/@temporalio/worker/package.json'
} = {}) {
  return {
    candidate,
    setup: {
      candidateVersion,
      candidateSourceRef,
      adapterSha256,
      environment: { os, arch, runtime },
      dependencyIdentity: {
        manifestSha256,
        packages: [{
          package: '@temporalio/worker',
          expectedVersion: installedVersion,
          declaredVersion: installedVersion,
          installedVersion,
          installedPackageJson
        }]
      }
    }
  };
}

test('formal environment consistency accepts one execution environment and one runtime identity per candidate', () => {
  const a = record({ installedPackageJson: '/runner/a/node_modules/@temporalio/worker/package.json' });
  const b = record({ installedPackageJson: '/runner/b/node_modules/@temporalio/worker/package.json' });
  const result = assessFormalEnvironmentConsistency([a, b]);
  assert.equal(result.consistent, true, result.errors.join('\n'));
  assert.equal(result.executionEnvironmentFingerprints.length, 1);
  assert.equal(result.candidateRuntimeFingerprints['Temporal TypeScript'].length, 1);
  assert.equal(formalCandidateRuntimeFingerprint(a), formalCandidateRuntimeFingerprint(b));
});

test('absolute installation path is not part of candidate runtime identity', () => {
  const a = record({ installedPackageJson: '/home/runner/work/a/node_modules/@temporalio/worker/package.json' });
  const b = record({ installedPackageJson: 'D:\\runner\\work\\b\\node_modules\\@temporalio\\worker\\package.json' });
  assert.equal(formalCandidateRuntimeFingerprint(a), formalCandidateRuntimeFingerprint(b));
});

test('Node, operating system or architecture drift changes execution environment identity', () => {
  const base = record();
  assert.notEqual(formalExecutionEnvironmentFingerprint(base), formalExecutionEnvironmentFingerprint(record({ runtime: 'node v24.0.0' })));
  assert.notEqual(formalExecutionEnvironmentFingerprint(base), formalExecutionEnvironmentFingerprint(record({ os: 'linux 6.12' })));
  assert.notEqual(formalExecutionEnvironmentFingerprint(base), formalExecutionEnvironmentFingerprint(record({ arch: 'arm64' })));

  const mixed = assessFormalEnvironmentConsistency([base, record({ runtime: 'node v24.0.0' })]);
  assert.equal(mixed.consistent, false);
  assert.match(mixed.errors.join('\n'), /multiple execution environments/);
});

test('candidate version, source, adapter, manifest or installed dependency drift changes candidate runtime identity', () => {
  const base = record();
  const variants = [
    record({ candidateVersion: '1.24.0' }),
    record({ candidateSourceRef: 'temporalio/sdk-typescript v1.24.0' }),
    record({ adapterSha256: 'c'.repeat(64) }),
    record({ manifestSha256: 'd'.repeat(64) }),
    record({ installedVersion: '1.24.0' })
  ];
  for (const variant of variants) assert.notEqual(formalCandidateRuntimeFingerprint(base), formalCandidateRuntimeFingerprint(variant));

  const mixed = assessFormalEnvironmentConsistency([base, variants[0]]);
  assert.equal(mixed.consistent, false);
  assert.match(mixed.errors.join('\n'), /multiple candidate runtime\/dependency identities/);
});

test('incomplete runtime or dependency provenance fails closed', () => {
  const missingRuntime = record({ runtime: '' });
  const missingManifest = record({ manifestSha256: '' });
  const result = assessFormalEnvironmentConsistency([missingRuntime, missingManifest]);
  assert.equal(result.consistent, false);
  assert.match(result.errors.join('\n'), /incomplete formal execution environment identity/);
  assert.match(result.errors.join('\n'), /incomplete candidate runtime\/dependency identity/);
});
