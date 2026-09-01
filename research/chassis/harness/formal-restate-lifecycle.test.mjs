import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRestateIsolationEnvironment,
  createRestateFormalLifecycle,
  RESTATE_FORMAL_ENV_NAMES,
  restateVersionMatchesFrozenProfile
} from './formal-restate-lifecycle.mjs';

function operations({ version = 'restate-server 1.7.8', health = true } = {}) {
  let nextPort = 24000;
  let workspacePresent = false;
  const livePids = new Set();
  return {
    createWorkspace: async () => {
      workspacePresent = true;
      return '/tmp/naia-restate-fixture';
    },
    pathExists: async (value) => value === '/tmp/naia-restate-fixture' ? workspacePresent : false,
    sha256File: async () => 'a'.repeat(64),
    platformIdentity: () => ({ platform: 'linux', arch: 'x64' }),
    allocatePort: async () => nextPort++,
    runCommand: async () => ({ code: 0, signal: null, stdout: `${version}\n`, stderr: '', spawnError: null }),
    startServer: () => {
      livePids.add(4100);
      return { pid: 4100, spawnError: null, stdout: '', stderr: '' };
    },
    stopServer: async () => {
      livePids.delete(4100);
      return true;
    },
    removeWorkspace: async () => { workspacePresent = false; },
    pidAlive: (pid) => livePids.has(pid),
    healthCheck: async () => ({ healthy: health, status: health ? 200 : 503, error: null })
  };
}

const spec = {
  experimentId: 'restate-t5-001',
  mutantId: 'T5',
  randomSeed: 17
};

test('Restate formal version matcher accepts only frozen 1.7.8 identity', () => {
  assert.equal(restateVersionMatchesFrozenProfile('restate-server 1.7.8'), true);
  assert.equal(restateVersionMatchesFrozenProfile('restate-server 1.7.9'), false);
  assert.equal(restateVersionMatchesFrozenProfile('restate-server 1.8.0'), false);
});

test('Restate isolation environment assigns explicit distinct loopback service endpoints', () => {
  const ports = {
    fabric: 24000, admin: 24001, ingress: 24002, endpoint: 24003,
    t5A: 24004, t5B: 24005, t11A: 24006, t11B: 24007,
    t12A: 24008, t12B: 24009, t16A: 24010, t16B: 24011
  };
  const value = buildRestateIsolationEnvironment(spec, ports);
  assert.equal(value.RESTATE_ADMIN_URL, 'http://127.0.0.1:24001');
  assert.equal(value.RESTATE_INGRESS_URL, 'http://127.0.0.1:24002');
  assert.equal(value.NAIA_RESTATE_ENDPOINT_PORT, '24003');
  assert.equal(value.NAIA_T5_RESTATE_PORT_A, '24004');
  assert.equal(value.NAIA_T5_RESTATE_PORT_B, '24005');
  assert.equal(value.NAIA_T11_RESTATE_PORT_A, '24006');
  assert.equal(value.NAIA_T11_RESTATE_PORT_B, '24007');
  assert.equal(value.NAIA_T12_RESTATE_PORT_A, '24008');
  assert.equal(value.NAIA_T12_RESTATE_PORT_B, '24009');
  assert.equal(value.NAIA_T16_RESTATE_PORT_A, '24010');
  assert.equal(value.NAIA_T16_RESTATE_PORT_B, '24011');
});

test('Restate formal lifecycle is structurally isolated and records native runtime identity', async () => {
  const env = { NAIA_RESTATE_SERVER: '/fixture/restate-server' };
  const lifecycle = createRestateFormalLifecycle({
    repositoryRoot: '/fixture/repository', env, operations: operations()
  });

  assert.equal(lifecycle.candidateName, 'Restate');
  assert.equal(lifecycle.status, 'IMPLEMENTED_NOT_RUNTIME_VERIFIED');
  for (const name of RESTATE_FORMAL_ENV_NAMES) assert.ok(lifecycle.declaredEnvNames.includes(name), name);

  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.serverSha256, 'a'.repeat(64));
  assert.match(receipt.versionOutput, /1\.7\.8/);
  assert.equal(receipt.formalRuntimeIdentity.kind, 'restate-local-server-runtime');
  assert.equal(receipt.formalRuntimeIdentity.serverSha256, 'a'.repeat(64));
  assert.equal(receipt.formalRuntimeIdentity.expectedProfile.serverVersion, '1.7.8');
  assert.equal(new Set(Object.values(receipt.ports)).size, 12);
  assert.equal(env.RESTATE_ADMIN_URL, 'http://127.0.0.1:24001');
  assert.equal(env.RESTATE_INGRESS_URL, 'http://127.0.0.1:24002');

  const cleanup = await lifecycle.cleanupHook(spec, { status: 'READY' }, {
    fault: { injected: true },
    rawObservations: {
      workerProcessPids: [5101, 5102],
      runnerProcess: { pid: 5199 }
    }
  });
  assert.equal(cleanup.status, 'PASS');
  assert.equal(cleanup.workerCleanup, true);
  assert.equal(cleanup.restateServerCleanup, true);
  assert.equal(cleanup.workspaceCleanup, true);
  assert.deepEqual(cleanup.workerProcessPids, [5101, 5102]);
  assert.deepEqual(cleanup.liveObservedWorkerPids, []);
});

test('Restate lifecycle fails closed when binary version differs from frozen server version', async () => {
  const lifecycle = createRestateFormalLifecycle({
    repositoryRoot: '/fixture/repository',
    env: { NAIA_RESTATE_SERVER: '/fixture/restate-server' },
    operations: operations({ version: 'restate-server 1.8.0' })
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'RESTATE_FORMAL_RUNTIME_VERSION_UNVERIFIED');
});

test('Restate lifecycle fails closed when NAIA_RESTATE_SERVER is absent', async () => {
  const lifecycle = createRestateFormalLifecycle({
    repositoryRoot: '/fixture/repository', env: {}, operations: operations()
  });
  const receipt = await lifecycle.preRunCleanupHook(spec);
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'RESTATE_FORMAL_SERVER_PATH_REQUIRED');
});
