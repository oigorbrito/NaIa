import assert from 'node:assert/strict';
import test from 'node:test';
import { currentLifecycleQualificationProvenance } from './formal-lifecycle-qualification-provenance.mjs';
import { validateRuntimeLifecycleReceipt } from './formal-lifecycle-runtime-receipt-validator.mjs';

const REPOSITORY_REVISION = '1'.repeat(40);

function qualificationRecord(candidate) {
  const provenance = currentLifecycleQualificationProvenance(candidate);
  return {
    profile: provenance.profile,
    candidate: provenance.candidate,
    sha256: provenance.aggregateSha256,
    fileCount: provenance.fileCount
  };
}

function dependencyIdentity(candidate) {
  if (candidate === 'Temporal TypeScript') {
    return {
      manifestSha256: 'd'.repeat(64),
      packages: [{
        package: '@temporalio/worker',
        expectedVersion: '1.23.0',
        declaredVersion: '1.23.0',
        installedVersion: '1.23.0'
      }]
    };
  }
  return {
    manifestSha256: 'e'.repeat(64),
    packages: [{
      package: '@dbos-inc/dbos-sdk',
      expectedVersion: '4.27.6',
      declaredVersion: '4.27.6',
      installedVersion: '4.27.6'
    }]
  };
}

function preRunReceipt(candidate) {
  const shared = {
    status: 'PASS',
    workerCleanup: true,
    durableStateCleanup: true,
    oracleCleanup: true,
    temporaryResourcesCleanup: true,
    evidenceId: `${candidate}:runtime-receipt`,
    observedPlatform: { platform: 'linux', arch: 'x64' }
  };
  if (candidate === 'Temporal TypeScript') {
    return {
      ...shared,
      cliSha256: 'f'.repeat(64),
      versionOutput: 'Temporal CLI 1.8.1 Server 1.31.2',
      expectedProfile: {
        sdkVersion: '1.23.0',
        cliVersion: '1.8.1',
        serverVersion: '1.31.2',
        platform: 'linux',
        arch: 'x64'
      },
      workspace: '/tmp/temporal-runtime-receipt',
      address: '127.0.0.1:7233',
      serverPid: 4500
    };
  }
  return {
    ...shared,
    dockerVersion: 'Docker version 28.0.0',
    postgresImage: 'postgres:16.10-alpine@sha256:' + '1'.repeat(64),
    postgresImageIdentity: 'postgres@sha256:' + '1'.repeat(64) + ' sha256:' + '2'.repeat(64),
    workspace: '/tmp/dbos-runtime-receipt',
    containerId: 'dynamic-container'
  };
}

function baseCleanup(candidate) {
  const shared = {
    status: 'PASS',
    workerCleanup: true,
    durableStateCleanup: true,
    oracleCleanup: true,
    temporaryResourcesCleanup: true,
    observedWorkerPids: [4101, 4102, 4199],
    liveObservedWorkerPids: [],
    workspaceCleanup: true
  };
  if (candidate === 'Temporal TypeScript') {
    return { ...shared, temporalServerCleanup: true, sqliteCleanup: true };
  }
  return {
    ...shared,
    cleanupContainerAllowed: true,
    databaseDrop: true,
    databaseAbsent: true,
    postgresContainerCleanup: true
  };
}

function makeRecord(candidate, overrides = {}) {
  const record = {
    schemaVersion: 1,
    experimentId: candidate === 'Temporal TypeScript' ? 'temporal-typescript-t5-001' : 'dbos-typescript-t5-001',
    candidate,
    mutantId: 'T5',
    repetition: 1,
    randomSeed: candidate === 'Temporal TypeScript' ? 1050001 : 2050001,
    setup: {
      status: 'READY',
      candidateVersion: candidate === 'Temporal TypeScript' ? '1.23.0' : '4.27.6',
      candidateSourceRef: candidate === 'Temporal TypeScript'
        ? 'temporalio/sdk-typescript v1.23.0'
        : 'dbos-inc/dbos-transact-ts v4.27',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: dependencyIdentity(candidate),
      environment: {
        os: 'linux 6.11.0',
        arch: 'x64',
        runtime: 'node v22.16.0',
        packageManager: null,
        repositoryProvenance: {
          source: 'git',
          status: 'VERIFIED',
          revision: REPOSITORY_REVISION,
          trackedWorktreeClean: true,
          reason: null
        },
        formalLifecycleQualification: qualificationRecord(candidate),
        formalRuntimeLifecycle: { candidate, status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED' }
      },
      parameters: {
        randomSeed: candidate === 'Temporal TypeScript' ? 1050001 : 2050001,
        mode: 'local-process',
        workerAuthorityBoundary: candidate === 'Temporal TypeScript' ? 'Temporal worker process' : 'DBOS executor process'
      },
      cleanupVerifiedBeforeRun: true,
      preRunCleanupReceipt: preRunReceipt(candidate)
    },
    run: {
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: { experimentId: 'qualification' },
      fault: {
        intended: 'T5', injected: true, targetKind: 'worker-process', targetIdentity: 4101,
        signal: 'SIGKILL', durableAuthorityAlive: true
      },
      rawObservations: {
        workerProcessPids: [4101, 4102],
        runnerProcess: { pid: 4199, exitCode: 0, timedOut: false }
      },
      acceptanceChecks: { semanticAuthorityCheck: false }
    },
    cleanup: baseCleanup(candidate),
    artifacts: [{ name: 'experiment-observations.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'FAIL',
    blocker: null
  };
  return {
    ...record,
    ...overrides,
    setup: {
      ...record.setup,
      ...(overrides.setup ?? {}),
      dependencyIdentity: overrides.setup?.dependencyIdentity === undefined
        ? record.setup.dependencyIdentity
        : overrides.setup.dependencyIdentity,
      parameters: { ...record.setup.parameters, ...(overrides.setup?.parameters ?? {}) },
      preRunCleanupReceipt: overrides.setup?.preRunCleanupReceipt === undefined
        ? record.setup.preRunCleanupReceipt
        : overrides.setup.preRunCleanupReceipt,
      environment: { ...record.setup.environment, ...(overrides.setup?.environment ?? {}) }
    },
    run: {
      ...record.run,
      ...(overrides.run ?? {}),
      rawObservations: { ...record.run.rawObservations, ...(overrides.run?.rawObservations ?? {}) }
    },
    cleanup: { ...record.cleanup, ...(overrides.cleanup ?? {}) }
  };
}

test('Temporal T5 runtime receipt can qualify lifecycle even when candidate semantic verdict is FAIL', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript'));
  assert.equal(result.valid, true);
  assert.equal(result.checks.repositoryRevisionVerified, true);
  assert.equal(result.checks.formalEnvironmentIdentityValid, true, result.formalEnvironmentIdentity.errors.join('\n'));
  assert.equal(result.checks.lifecycleQualificationBundleCurrent, true);
  assert.match(result.formalEnvironmentIdentity.commonSha256, /^[a-f0-9]{64}$/);
  assert.match(result.formalEnvironmentIdentity.candidateProfileSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.candidateVerdict, 'FAIL');
  assert.equal(result.candidateVerdictIgnoredForLifecycleVerification, true);
  assert.deepEqual(result.workerProcessPids, [4101, 4102]);
  assert.equal(result.eligibleForLifecycleStatusPromotion, true);
  assert.equal(result.benchmarkPromotionAllowed, false);
  assert.equal(result.ledgerAppendAllowed, false);
});

test('DBOS T5 runtime receipt can qualify lifecycle independently of candidate semantic verdict', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('DBOS TypeScript'));
  assert.equal(result.valid, true);
  assert.equal(result.checks.repositoryRevisionVerified, true);
  assert.equal(result.checks.formalEnvironmentIdentityValid, true, result.formalEnvironmentIdentity.errors.join('\n'));
  assert.equal(result.checks.lifecycleQualificationBundleCurrent, true);
  assert.equal(result.eligibleForLifecycleStatusPromotion, true);
  assert.equal(result.checks.databaseAbsent, true);
  assert.equal(result.checks.postgresContainerCleanup, true);
});

test('runtime lifecycle receipt rejects READY execution without verified Git repository provenance', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    setup: {
      environment: {
        repositoryProvenance: {
          source: 'git', status: 'UNVERIFIED', revision: REPOSITORY_REVISION,
          trackedWorktreeClean: false, reason: 'TRACKED_WORKTREE_DIRTY'
        }
      }
    }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.repositoryRevisionVerified, false);
});

test('runtime lifecycle receipt rejects READY execution without complete formal environment identity', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    setup: { dependencyIdentity: null }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.formalEnvironmentIdentityValid, false);
  assert.match(result.formalEnvironmentIdentity.errors.join('\n'), /manifestSha256|installed formal dependency set/);
});

test('runtime lifecycle receipt rejects stale candidate qualification bundle', () => {
  const qualification = qualificationRecord('Temporal TypeScript');
  qualification.sha256 = '0'.repeat(64);
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    setup: { environment: { formalLifecycleQualification: qualification } }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.lifecycleQualificationBundleCurrent, false);
});

test('runtime lifecycle receipt rejects driver-only PID provenance', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    run: { rawObservations: { workerProcessPids: [] } }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.explicitWorkerProcessPidsPresent, false);
});

test('runtime lifecycle receipt rejects vacuous cleanup observation without explicit worker PIDs', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    cleanup: { observedWorkerPids: [4199] }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.explicitWorkerPidsIncludedInCleanupObservation, false);
});

test('runtime lifecycle receipt rejects missing cleanup PID observation entirely', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    cleanup: { observedWorkerPids: [] }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.observedWorkerPidsPresent, false);
});

test('runtime lifecycle receipt rejects any observed worker still alive after cleanup', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('DBOS TypeScript', {
    cleanup: { liveObservedWorkerPids: [4102] }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.noObservedWorkerPidAliveAfterCleanup, false);
});

test('runtime lifecycle receipt rejects non-PASS cleanup for a READY execution', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    cleanup: { status: 'NOT_APPLICABLE' }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.cleanupPass, false);
});

test('runtime lifecycle receipt is pinned to T5 repetition 1 rather than a post-hoc convenient mutant', () => {
  const result = validateRuntimeLifecycleReceipt(makeRecord('Temporal TypeScript', {
    mutantId: 'T7',
    experimentId: 'temporal-typescript-t7-001',
    run: { fault: { intended: 'T7', injected: true, targetKind: 'worker-process', targetIdentity: 4101, signal: 'SIGKILL', durableAuthorityAlive: true } }
  }));
  assert.equal(result.eligibleForLifecycleStatusPromotion, false);
  assert.equal(result.checks.firstPreregisteredMutant, false);
});
