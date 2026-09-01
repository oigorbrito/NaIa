import assert from 'node:assert/strict';
import test from 'node:test';
import { preRunCleanupReceiptValid } from './candidate-experiment.mjs';
import { FORMAL_CLEANUP_SUPPORT } from './formal-cleanup-support.mjs';
import {
  TEMPORAL_FORMAL_PROFILE,
  buildTemporalIsolationEnvironment,
  collectObservedPids,
  createFormalRuntimeLifecycle,
  temporalVersionMatchesFrozenProfile
} from './formal-runtime-lifecycle.mjs';

function fakeTemporalOperations({
  version = 'Temporal CLI 1.8.1 (Server 1.31.2)',
  digest = TEMPORAL_FORMAL_PROFILE.cliSha256,
  platform = 'linux',
  arch = 'x64'
} = {}) {
  let serverAlive = false;
  let workspacePresent = true;
  let sqlitePresent = false;
  const calls = [];

  return {
    calls,
    async createWorkspace() {
      calls.push('createWorkspace');
      workspacePresent = true;
      return '/virtual/naia-temporal-formal';
    },
    async pathExists(value) {
      if (value.endsWith('temporal.sqlite')) return sqlitePresent;
      if (value === '/virtual/naia-temporal-formal') return workspacePresent;
      return false;
    },
    async sha256File() {
      calls.push('sha256File');
      return digest;
    },
    platformIdentity() {
      return { platform, arch };
    },
    async allocatePort() {
      calls.push('allocatePort');
      return 27123;
    },
    async runCommand(_command, args) {
      calls.push(`run:${args.join(' ')}`);
      if (args[0] === '--version') return { code: 0, signal: null, stdout: version, stderr: '', spawnError: null };
      if (args.slice(0, 3).join(' ') === 'operator cluster health') {
        return { code: serverAlive ? 0 : 1, signal: null, stdout: '', stderr: '', spawnError: null };
      }
      return { code: 1, signal: null, stdout: '', stderr: 'unexpected fake command', spawnError: null };
    },
    startServer() {
      calls.push('startServer');
      serverAlive = true;
      sqlitePresent = true;
      return { pid: 4242, child: {}, stdout: '', stderr: '', spawnError: null };
    },
    pidAlive(pid) {
      if (pid === 4242) return serverAlive;
      return false;
    },
    async stopServer() {
      calls.push('stopServer');
      serverAlive = false;
      return true;
    },
    async removeWorkspace() {
      calls.push('removeWorkspace');
      workspacePresent = false;
      sqlitePresent = false;
    }
  };
}

const spec = Object.freeze({
  experimentId: 'temporal-typescript-t7-001',
  candidate: 'Temporal TypeScript',
  mutantId: 'T7',
  repetition: 1,
  randomSeed: 1070001
});

function injectedT7Run({ explicitWorkerPid = true } = {}) {
  return {
    fault: { intended: 'T7', injected: true },
    rawObservations: {
      ...(explicitWorkerPid ? { workerProcessPids: [9001] } : {}),
      runnerProcess: { pid: 9099, exitCode: 0, timedOut: false },
      recoveryWorker: { pid: 9001 }
    }
  };
}

test('Temporal isolation environment derives experiment-unique task queues from preregistered identity', () => {
  const first = buildTemporalIsolationEnvironment(spec, '127.0.0.1:27123');
  const second = buildTemporalIsolationEnvironment({ ...spec, repetition: 2, experimentId: 'temporal-typescript-t7-002', randomSeed: 1070002 }, '127.0.0.1:27124');

  assert.equal(first.TEMPORAL_ADDRESS, '127.0.0.1:27123');
  assert.equal(first.TEMPORAL_NAMESPACE, 'default');
  assert.notEqual(first.NAIA_TEMPORAL_TASK_QUEUE, second.NAIA_TEMPORAL_TASK_QUEUE);
  assert.notEqual(first.NAIA_TEMPORAL_T5_TASK_QUEUE, first.NAIA_TEMPORAL_T11_TASK_QUEUE);
  assert.match(first.NAIA_TEMPORAL_TASK_QUEUE, /temporal-typescript-t7-001/);
});

test('Temporal frozen runtime identity rejects CLI or embedded server drift', () => {
  assert.equal(temporalVersionMatchesFrozenProfile('Temporal CLI 1.8.1 (Server 1.31.2)'), true);
  assert.equal(temporalVersionMatchesFrozenProfile('Temporal CLI 1.8.2 (Server 1.31.2)'), false);
  assert.equal(temporalVersionMatchesFrozenProfile('Temporal CLI 1.8.1 (Server 1.32.0)'), false);
});

test('Temporal lifecycle emits a complete pre-run receipt and binds explicit worker PID cleanup', async () => {
  const env = { NAIA_TEMPORAL_CLI: '/pinned/temporal' };
  const operations = fakeTemporalOperations();
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/virtual/repository',
    env,
    timeoutMs: 1000,
    operations
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'PASS');
  assert.equal(preRunCleanupReceiptValid(receipt), true);
  assert.equal(receipt.sqliteExistedBeforeStart, false);
  assert.equal(receipt.cliSha256, TEMPORAL_FORMAL_PROFILE.cliSha256);
  assert.deepEqual(receipt.observedPlatform, { platform: 'linux', arch: 'x64' });
  assert.equal(receipt.serverPid, 4242);
  assert.equal(env.TEMPORAL_ADDRESS, '127.0.0.1:27123');
  assert.match(env.NAIA_TEMPORAL_TASK_QUEUE, /temporal-typescript-t7-001/);

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'READY' }, injectedT7Run());

  assert.equal(cleanup.status, 'PASS');
  assert.equal(cleanup.workerCleanup, true);
  assert.equal(cleanup.workerPidProvenanceRequired, true);
  assert.equal(cleanup.workerPidProvenanceObserved, true);
  assert.deepEqual(cleanup.workerProcessPids, [9001]);
  assert.equal(cleanup.durableStateCleanup, true);
  assert.equal(cleanup.oracleCleanup, true);
  assert.equal(cleanup.temporaryResourcesCleanup, true);
  assert.deepEqual(cleanup.observedWorkerPids.sort((a, b) => a - b), [9001, 9099]);
  assert.equal(cleanup.temporalServerPid, 4242);
  assert.ok(operations.calls.includes('stopServer'));
  assert.ok(operations.calls.includes('removeWorkspace'));
});

test('Temporal lifecycle fails cleanup when critical injected run exposes only generic/driver PID evidence', async () => {
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/virtual/repository',
    env: { NAIA_TEMPORAL_CLI: '/pinned/temporal' },
    timeoutMs: 1000,
    operations: fakeTemporalOperations()
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'PASS');

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'READY' }, injectedT7Run({ explicitWorkerPid: false }));
  assert.equal(cleanup.workerPidProvenanceRequired, true);
  assert.equal(cleanup.workerPidProvenanceObserved, false);
  assert.equal(cleanup.workerCleanup, false);
  assert.equal(cleanup.status, 'FAIL');
});

test('Temporal lifecycle fails closed when the binary digest is not the frozen Linux amd64 asset', async () => {
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/virtual/repository',
    env: { NAIA_TEMPORAL_CLI: '/wrong/temporal' },
    timeoutMs: 1000,
    operations: fakeTemporalOperations({ digest: '0'.repeat(64) })
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'TEMPORAL_FORMAL_CLI_DIGEST_MISMATCH');
  assert.equal(preRunCleanupReceiptValid(receipt), false);
});

test('Temporal lifecycle fails closed outside the frozen Linux x64 execution profile', async () => {
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/virtual/repository',
    env: { NAIA_TEMPORAL_CLI: '/pinned/temporal' },
    timeoutMs: 1000,
    operations: fakeTemporalOperations({ platform: 'win32', arch: 'x64' })
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'TEMPORAL_FORMAL_PLATFORM_PROFILE_MISMATCH');
  assert.equal(preRunCleanupReceiptValid(receipt), false);
});

test('Temporal lifecycle fails closed when the runtime version is not the frozen profile', async () => {
  const env = { NAIA_TEMPORAL_CLI: '/wrong/temporal' };
  const operations = fakeTemporalOperations({ version: 'Temporal CLI 1.8.2 (Server 1.31.2)' });
  const lifecycle = createFormalRuntimeLifecycle({
    candidateName: 'Temporal TypeScript',
    repositoryRoot: '/virtual/repository',
    env,
    timeoutMs: 1000,
    operations
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'TEMPORAL_FORMAL_RUNTIME_VERSION_UNVERIFIED');
  assert.equal(preRunCleanupReceiptValid(receipt), false);

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'BLOCKED_SETUP' }, { rawObservations: {} });
  assert.equal(cleanup.status, 'NOT_APPLICABLE');
  assert.equal(cleanup.workerPidProvenanceRequired, false);
  assert.equal(cleanup.durableStateCleanup, true);
});

test('observed PID collection is exact and does not treat arbitrary numeric fields as process identities', () => {
  const pids = [...collectObservedPids({
    workerA: { pid: 3101, attempt: 1 },
    nested: [{ pid: 3102 }, { eventId: 3103 }],
    currentProcess: { pid: process.pid }
  })].sort((a, b) => a - b);
  assert.deepEqual(pids, [3101, 3102]);
});

test('cleanup support remains closed until lifecycle execution evidence exists', () => {
  assert.equal(FORMAL_CLEANUP_SUPPORT['Temporal TypeScript'].status, 'IMPLEMENTED_NOT_RUNTIME_VERIFIED');
  assert.equal(FORMAL_CLEANUP_SUPPORT['Temporal TypeScript'].preRunCleanup, false);
  assert.equal(FORMAL_CLEANUP_SUPPORT['Temporal TypeScript'].postRunCleanup, false);
});

test('non-Temporal candidates do not receive an undeclared lifecycle', () => {
  assert.equal(createFormalRuntimeLifecycle({ candidateName: 'DBOS TypeScript', repositoryRoot: '/virtual', env: {} }), null);
  assert.equal(createFormalRuntimeLifecycle({ candidateName: 'Restate', repositoryRoot: '/virtual', env: {} }), null);
});
