import assert from 'node:assert/strict';
import test from 'node:test';
import { preRunCleanupReceiptValid } from './candidate-experiment.mjs';
import { FORMAL_CLEANUP_SUPPORT } from './formal-cleanup-support.mjs';
import { DBOS_FORMAL_PROFILE, createDbosFormalLifecycle } from './formal-dbos-lifecycle.mjs';

function fakeDbosOperations({
  platform = 'linux',
  arch = 'x64',
  dockerAvailable = true,
  preexistingContainer = false,
  imageIdentity = `repo@${DBOS_FORMAL_PROFILE.postgresDigest} sha256:fake-image-id`
} = {}) {
  let workspacePresent = true;
  let containerPresent = preexistingContainer;
  let databasePresent = false;
  const calls = [];

  function ok(stdout = '') {
    return { code: 0, signal: null, stdout, stderr: '', spawnError: null };
  }
  function fail(stderr = '') {
    return { code: 1, signal: null, stdout: '', stderr, spawnError: null };
  }

  return {
    calls,
    async createWorkspace() {
      calls.push('createWorkspace');
      workspacePresent = true;
      return '/virtual/naia-dbos-formal';
    },
    async pathExists(value) {
      return value === '/virtual/naia-dbos-formal' ? workspacePresent : false;
    },
    platformIdentity() {
      return { platform, arch };
    },
    async allocatePort() {
      calls.push('allocatePort');
      return 25432;
    },
    async waitForTcp() {
      calls.push('waitForTcp');
      return containerPresent;
    },
    pidAlive() {
      return false;
    },
    async removeWorkspace() {
      calls.push('removeWorkspace');
      workspacePresent = false;
    },
    async runCommand(_command, args) {
      calls.push(args.join(' '));
      if (args[0] === '--version') return dockerAvailable ? ok('Docker version 28.0.0') : fail('docker unavailable');
      if (args[0] === 'pull') return ok('pulled');
      if (args[0] === 'image' && args[1] === 'inspect') return ok(imageIdentity);
      if (args[0] === 'run') {
        containerPresent = true;
        databasePresent = true;
        return ok('fake-container-id');
      }
      if (args[0] === 'inspect' && args[1] === '--format') {
        return containerPresent ? ok('true\n') : fail('not found');
      }
      if (args[0] === 'inspect') return containerPresent ? ok('present') : fail('not found');
      if (args[0] === 'exec' && args.includes('DROP DATABASE IF EXISTS naia_chassis WITH (FORCE);')) {
        databasePresent = false;
        return ok('DROP DATABASE');
      }
      if (args[0] === 'exec' && args.some((arg) => String(arg).includes("SELECT count(*) FROM pg_database"))) {
        return ok(databasePresent ? '1\n' : '0\n');
      }
      if (args[0] === 'rm' && args[1] === '-f') {
        containerPresent = false;
        return ok('removed');
      }
      return fail(`unexpected fake command: ${args.join(' ')}`);
    }
  };
}

const spec = Object.freeze({
  experimentId: 'dbos-typescript-t5-001',
  candidate: 'DBOS TypeScript',
  mutantId: 'T5',
  repetition: 1,
  randomSeed: 2050001
});

test('DBOS lifecycle creates an isolated digest-pinned database and proves cleanup of owned resources', async () => {
  const env = {};
  const operations = fakeDbosOperations();
  const lifecycle = createDbosFormalLifecycle({
    repositoryRoot: '/virtual/repository',
    env,
    timeoutMs: 1000,
    operations
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'PASS');
  assert.equal(preRunCleanupReceiptValid(receipt), true);
  assert.equal(receipt.postgresImage, DBOS_FORMAL_PROFILE.postgresImage);
  assert.equal(receipt.containerId, 'fake-container-id');
  assert.match(receipt.containerName, /dbos-typescript-t5-001/);
  assert.equal(env.DBOS_SYSTEM_DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:25432/naia_chassis');

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'READY' }, {
    rawObservations: {
      runnerProcess: { exitCode: 0, timedOut: false },
      workerA: { pid: 9101 },
      workerB: { pid: 9102 }
    }
  });

  assert.equal(cleanup.status, 'PASS');
  assert.equal(cleanup.workerCleanup, true);
  assert.equal(cleanup.durableStateCleanup, true);
  assert.equal(cleanup.oracleCleanup, true);
  assert.equal(cleanup.temporaryResourcesCleanup, true);
  assert.deepEqual(cleanup.observedWorkerPids.sort((a, b) => a - b), [9101, 9102]);
  assert.deepEqual(cleanup.liveObservedWorkerPids, []);
  assert.equal(cleanup.cleanupContainerAllowed, true);
  assert.equal(cleanup.databaseDrop, true);
  assert.equal(cleanup.databaseAbsent, true);
  assert.equal(cleanup.postgresContainerCleanup, true);
  assert.equal(cleanup.workspaceCleanup, true);
  assert.ok(operations.calls.some((call) => call.includes('DROP DATABASE IF EXISTS naia_chassis')));
  assert.ok(operations.calls.some((call) => call.startsWith('rm -f ')));
});

test('DBOS lifecycle preserves a preexisting experiment-name container and fails closed before ownership', async () => {
  const operations = fakeDbosOperations({ preexistingContainer: true });
  const lifecycle = createDbosFormalLifecycle({
    repositoryRoot: '/virtual/repository',
    env: {},
    timeoutMs: 1000,
    operations
  });

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'DBOS_FORMAL_PREEXISTING_CONTAINER');
  assert.equal(receipt.preexistingResourcePreserved, true);
  assert.equal(preRunCleanupReceiptValid(receipt), false);

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'BLOCKED_SETUP' }, { rawObservations: {} });
  assert.equal(cleanup.cleanupContainerAllowed, false);
  assert.equal(operations.calls.some((call) => call.startsWith('rm -f ')), false);
});

test('DBOS lifecycle fails closed when PostgreSQL image digest is not the frozen digest', async () => {
  const lifecycle = createDbosFormalLifecycle({
    repositoryRoot: '/virtual/repository',
    env: {},
    timeoutMs: 1000,
    operations: fakeDbosOperations({ imageIdentity: 'postgres:16 sha256:wrong' })
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'DBOS_FORMAL_POSTGRES_DIGEST_UNVERIFIED');
  assert.equal(preRunCleanupReceiptValid(receipt), false);
});

test('DBOS lifecycle fails closed outside the frozen Linux x64 profile', async () => {
  const lifecycle = createDbosFormalLifecycle({
    repositoryRoot: '/virtual/repository',
    env: {},
    timeoutMs: 1000,
    operations: fakeDbosOperations({ platform: 'win32' })
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'DBOS_FORMAL_PLATFORM_PROFILE_MISMATCH');
});

test('DBOS lifecycle classifies unavailable Docker as setup failure rather than candidate failure', async () => {
  const lifecycle = createDbosFormalLifecycle({
    repositoryRoot: '/virtual/repository',
    env: {},
    timeoutMs: 1000,
    operations: fakeDbosOperations({ dockerAvailable: false })
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'DBOS_FORMAL_DOCKER_UNAVAILABLE');
});

test('DBOS formal cleanup support stays closed until real runtime receipt exists', () => {
  assert.equal(FORMAL_CLEANUP_SUPPORT['DBOS TypeScript'].status, 'IMPLEMENTED_NOT_RUNTIME_VERIFIED');
  assert.equal(FORMAL_CLEANUP_SUPPORT['DBOS TypeScript'].preRunCleanup, false);
  assert.equal(FORMAL_CLEANUP_SUPPORT['DBOS TypeScript'].postRunCleanup, false);
});
