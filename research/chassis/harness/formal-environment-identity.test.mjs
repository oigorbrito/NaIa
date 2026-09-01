import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessFormalEnvironmentConsistency,
  deriveFormalEnvironmentIdentity
} from './formal-environment-identity.mjs';

const SHA = 'a'.repeat(64);

function temporalRecord(overrides = {}) {
  return {
    candidate: 'Temporal TypeScript',
    setup: {
      status: 'READY',
      candidateVersion: overrides.candidateVersion ?? '1.23.0',
      candidateSourceRef: overrides.candidateSourceRef ?? 'temporalio/sdk-typescript v1.23.0',
      adapterSha256: overrides.adapterSha256 ?? 'b'.repeat(64),
      harnessSha256: 'c'.repeat(64),
      dependencyIdentity: {
        manifestPath: overrides.manifestPath ?? '/runner/a/research/chassis/adapters/temporal-ts/package.json',
        manifestSha256: overrides.manifestSha256 ?? 'd'.repeat(64),
        packages: [{
          package: '@temporalio/worker',
          expectedVersion: '1.23.0',
          declaredVersion: '1.23.0',
          installedVersion: overrides.installedVersion ?? '1.23.0',
          installedPackageJson: overrides.installedPackageJson ?? '/runner/a/node_modules/@temporalio/worker/package.json'
        }]
      },
      environment: {
        os: overrides.os ?? 'linux 6.11.0',
        arch: overrides.arch ?? 'x64',
        runtime: overrides.runtime ?? 'node v22.16.0',
        packageManager: Object.prototype.hasOwnProperty.call(overrides, 'packageManager') ? overrides.packageManager : null,
        formalLifecycleQualification: { sha256: overrides.lifecycleQualificationSha256 ?? SHA }
      },
      parameters: {
        mode: overrides.mode ?? 'local-process',
        workerAuthorityBoundary: overrides.workerAuthorityBoundary ?? 'Temporal worker process'
      },
      preRunCleanupReceipt: {
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        cliSha256: overrides.cliSha256 ?? 'e'.repeat(64),
        versionOutput: overrides.versionOutput ?? 'Temporal CLI 1.8.1 Server 1.31.2',
        expectedProfile: overrides.expectedProfile ?? {
          sdkVersion: '1.23.0', cliVersion: '1.8.1', serverVersion: '1.31.2', platform: 'linux', arch: 'x64'
        },
        observedPlatform: overrides.observedPlatform ?? { platform: 'linux', arch: 'x64' },
        workspace: overrides.workspace ?? '/tmp/run-a',
        address: overrides.address ?? '127.0.0.1:7233',
        serverPid: overrides.serverPid ?? 111,
        taskQueues: { NAIA_TEMPORAL_TASK_QUEUE: overrides.taskQueue ?? 'run-a-common' }
      }
    }
  };
}

function dbosRecord(overrides = {}) {
  return {
    candidate: 'DBOS TypeScript',
    setup: {
      status: 'READY',
      candidateVersion: '4.27.6',
      candidateSourceRef: 'dbos-inc/dbos-transact-ts v4.27',
      adapterSha256: 'f'.repeat(64),
      harnessSha256: 'c'.repeat(64),
      dependencyIdentity: {
        manifestSha256: '1'.repeat(64),
        packages: [{
          package: '@dbos-inc/dbos-sdk',
          expectedVersion: '4.27.6',
          declaredVersion: '4.27.6',
          installedVersion: '4.27.6'
        }]
      },
      environment: {
        os: overrides.os ?? 'linux 6.11.0',
        arch: 'x64',
        runtime: 'node v22.16.0',
        packageManager: null,
        formalLifecycleQualification: { sha256: '2'.repeat(64) }
      },
      parameters: {
        mode: 'local-process',
        workerAuthorityBoundary: 'DBOS executor process'
      },
      preRunCleanupReceipt: {
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        dockerVersion: overrides.dockerVersion ?? 'Docker version 28.0.0',
        postgresImage: 'postgres:16.10-alpine@sha256:' + '3'.repeat(64),
        postgresImageIdentity: 'postgres@sha256:' + '3'.repeat(64) + ' sha256:' + '4'.repeat(64),
        observedPlatform: { platform: 'linux', arch: 'x64' },
        workspace: '/tmp/dbos-a',
        containerId: overrides.containerId ?? 'dynamic-container-a',
        databaseUrlRedacted: 'postgresql://postgres:***@127.0.0.1:54321/naia_chassis'
      }
    }
  };
}

test('dynamic paths ports PIDs queues and container identities do not change canonical formal or native runtime identity', () => {
  const a = deriveFormalEnvironmentIdentity(temporalRecord());
  const b = deriveFormalEnvironmentIdentity(temporalRecord({
    manifestPath: '/different/checkout/package.json',
    installedPackageJson: '/different/checkout/node_modules/@temporalio/worker/package.json',
    workspace: '/tmp/run-b',
    address: '127.0.0.1:8123',
    serverPid: 99999,
    taskQueue: 'run-b-common'
  }));
  assert.equal(a.valid, true, a.errors.join('\n'));
  assert.equal(b.valid, true, b.errors.join('\n'));
  assert.equal(a.commonSha256, b.commonSha256);
  assert.equal(a.candidateProfileSha256, b.candidateProfileSha256);
  assert.equal(a.runtimeIdentitySha256, b.runtimeIdentitySha256);
  assert.match(a.runtimeIdentitySha256, /^[a-f0-9]{64}$/);

  const dbosA = deriveFormalEnvironmentIdentity(dbosRecord({ containerId: 'one' }));
  const dbosB = deriveFormalEnvironmentIdentity(dbosRecord({ containerId: 'two' }));
  assert.equal(dbosA.candidateProfileSha256, dbosB.candidateProfileSha256);
  assert.equal(dbosA.runtimeIdentitySha256, dbosB.runtimeIdentitySha256);
});

test('Node OS architecture or package-manager drift changes common execution environment identity but not native runtime identity', () => {
  const base = deriveFormalEnvironmentIdentity(temporalRecord());
  const nodeChanged = deriveFormalEnvironmentIdentity(temporalRecord({ runtime: 'node v24.0.0' }));
  const osChanged = deriveFormalEnvironmentIdentity(temporalRecord({ os: 'linux 6.12.0' }));
  const archChanged = deriveFormalEnvironmentIdentity(temporalRecord({ arch: 'arm64' }));
  const packageManagerChanged = deriveFormalEnvironmentIdentity(temporalRecord({ packageManager: 'npm/10.9.2 node/v22.16.0 linux x64' }));
  assert.notEqual(base.commonSha256, nodeChanged.commonSha256);
  assert.notEqual(base.commonSha256, osChanged.commonSha256);
  assert.notEqual(base.commonSha256, archChanged.commonSha256);
  assert.notEqual(base.commonSha256, packageManagerChanged.commonSha256);
  assert.equal(base.runtimeIdentitySha256, nodeChanged.runtimeIdentitySha256);
  assert.equal(base.runtimeIdentitySha256, osChanged.runtimeIdentitySha256);
  assert.equal(base.runtimeIdentitySha256, packageManagerChanged.runtimeIdentitySha256);
});

test('every frozen candidate profile dimension contributes to candidate profile identity', () => {
  const base = deriveFormalEnvironmentIdentity(temporalRecord());
  const variants = [
    temporalRecord({ candidateVersion: '1.23.1' }),
    temporalRecord({ candidateSourceRef: 'temporalio/sdk-typescript v1.23.1' }),
    temporalRecord({ adapterSha256: '9'.repeat(64) }),
    temporalRecord({ manifestSha256: '8'.repeat(64) }),
    temporalRecord({ mode: 'different-mode' }),
    temporalRecord({ workerAuthorityBoundary: 'different authority boundary' }),
    temporalRecord({ lifecycleQualificationSha256: '7'.repeat(64) }),
    temporalRecord({ cliSha256: '6'.repeat(64) }),
    temporalRecord({ versionOutput: 'Temporal CLI 1.8.1 Server 1.31.2 build-different' }),
    temporalRecord({ observedPlatform: { platform: 'linux', arch: 'x64', variant: 'different' } })
  ];

  assert.equal(base.valid, true, base.errors.join('\n'));
  for (const variant of variants) {
    const identity = deriveFormalEnvironmentIdentity(variant);
    assert.equal(identity.valid, true, identity.errors.join('\n'));
    assert.notEqual(base.candidateProfileSha256, identity.candidateProfileSha256);
  }
});

test('native runtime drift changes both native runtime identity and candidate profile identity', () => {
  const temporalBase = deriveFormalEnvironmentIdentity(temporalRecord());
  const temporalChanged = deriveFormalEnvironmentIdentity(temporalRecord({ cliSha256: '6'.repeat(64) }));
  assert.notEqual(temporalBase.runtimeIdentitySha256, temporalChanged.runtimeIdentitySha256);
  assert.notEqual(temporalBase.candidateProfileSha256, temporalChanged.candidateProfileSha256);

  const dbosBase = deriveFormalEnvironmentIdentity(dbosRecord());
  const dockerChanged = deriveFormalEnvironmentIdentity(dbosRecord({ dockerVersion: 'Docker version 29.0.0' }));
  assert.notEqual(dbosBase.runtimeIdentitySha256, dockerChanged.runtimeIdentitySha256);
  assert.notEqual(dbosBase.candidateProfileSha256, dockerChanged.candidateProfileSha256);
});

test('installed dependency or native runtime drift changes candidate profile identity', () => {
  const base = deriveFormalEnvironmentIdentity(temporalRecord());
  const sdkChanged = deriveFormalEnvironmentIdentity(temporalRecord({ installedVersion: '1.24.0' }));
  assert.equal(sdkChanged.valid, false);
  assert.match(sdkChanged.errors.join('\n'), /expected, declared and installed versions must match exactly/);

  const dbosBase = deriveFormalEnvironmentIdentity(dbosRecord());
  const dockerChanged = deriveFormalEnvironmentIdentity(dbosRecord({ dockerVersion: 'Docker version 29.0.0' }));
  assert.notEqual(dbosBase.candidateProfileSha256, dockerChanged.candidateProfileSha256);
  assert.equal(base.valid, true, base.errors.join('\n'));
});

test('different candidates may have different candidate profiles while sharing one common environment', () => {
  const result = assessFormalEnvironmentConsistency([temporalRecord(), dbosRecord()]);
  assert.equal(result.consistent, true, result.errors.join('\n'));
  assert.equal(result.commonEnvironmentSha256s.length, 1);
  assert.equal(result.candidateProfiles['Temporal TypeScript'].length, 1);
  assert.equal(result.candidateProfiles['DBOS TypeScript'].length, 1);
});

test('same candidate mixed across common runtime or candidate profile identities is rejected', () => {
  const commonDrift = assessFormalEnvironmentConsistency([
    temporalRecord(),
    temporalRecord({ runtime: 'node v24.0.0' })
  ]);
  assert.equal(commonDrift.consistent, false);
  assert.match(commonDrift.errors.join('\n'), /multiple common execution environment identities/);

  const profileDrift = assessFormalEnvironmentConsistency([
    dbosRecord(),
    dbosRecord({ dockerVersion: 'Docker version 29.0.0' })
  ]);
  assert.equal(profileDrift.consistent, false);
  assert.match(profileDrift.errors.join('\n'), /DBOS TypeScript: READY formal records span multiple candidate execution profile identities/);
});

test('READY record with missing installed dependency identity is rejected rather than treated as an equivalent environment', () => {
  const value = temporalRecord();
  value.setup.dependencyIdentity.packages[0].installedVersion = null;
  const result = deriveFormalEnvironmentIdentity(value);
  assert.equal(result.valid, false);
  assert.equal(result.runtimeIdentitySha256, null);
  assert.match(result.errors.join('\n'), /installedVersion is required/);
});
