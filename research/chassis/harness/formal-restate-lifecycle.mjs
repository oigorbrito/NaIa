import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assessWorkerPidCleanup } from './formal-worker-pid-provenance.mjs';

export const RESTATE_FORMAL_PROFILE = Object.freeze({
  serverVersion: '1.7.8',
  sdkVersion: '1.16.9',
  platform: 'linux',
  arch: 'x64'
});

export const RESTATE_FORMAL_ENV_NAMES = Object.freeze([
  'NAIA_RESTATE_SERVER',
  'RESTATE_ADMIN_URL',
  'RESTATE_INGRESS_URL',
  'NAIA_RESTATE_ENDPOINT_PORT',
  'NAIA_RESTATE_PUBLIC_ENDPOINT',
  'NAIA_T5_RESTATE_PORT_A',
  'NAIA_T5_RESTATE_PORT_B',
  'NAIA_T11_RESTATE_PORT_A',
  'NAIA_T11_RESTATE_PORT_B',
  'NAIA_T12_RESTATE_PORT_A',
  'NAIA_T12_RESTATE_PORT_B',
  'NAIA_T16_RESTATE_PORT_A',
  'NAIA_T16_RESTATE_PORT_B'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function allocateLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!Number.isInteger(port) || port <= 0) throw new Error('failed to allocate loopback port');
  return port;
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  const result = await new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      resolve({ code: null, signal: null });
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { ...result, stdout, stderr, spawnError: spawnError ? String(spawnError) : null };
}

function startServer(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, pid: child.pid ?? null, stdout: '', stderr: '', spawnError: null };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => { state.stdout += chunk; });
  child.stderr?.on('data', (chunk) => { state.stderr += chunk; });
  child.once('error', (error) => { state.spawnError = String(error); });
  return state;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function stopServer(handle) {
  if (!handle?.child) return true;
  const child = handle.child;
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(5000).then(() => false)
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      sleep(3000).then(() => false)
    ]);
  }
  return !pidAlive(handle.pid);
}

async function healthCheck(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { healthy: response.status === 200, status: response.status, error: null };
  } catch (error) {
    return { healthy: false, status: null, error: String(error) };
  }
}

function defaultOperations() {
  return {
    createWorkspace: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
    pathExists,
    sha256File,
    platformIdentity: () => ({ platform: process.platform, arch: process.arch }),
    allocatePort: allocateLoopbackPort,
    runCommand,
    startServer,
    stopServer,
    removeWorkspace: (workspace) => rm(workspace, { recursive: true, force: true }),
    pidAlive,
    healthCheck
  };
}

export function restateVersionMatchesFrozenProfile(text) {
  return /\b1\.7\.8\b/.test(String(text ?? ''));
}

function safeIdentity(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120);
}

async function allocateDistinctPorts(ops, count) {
  const ports = [];
  while (ports.length < count) {
    const port = await ops.allocatePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

export function buildRestateIsolationEnvironment(spec, ports) {
  if (!spec?.experimentId) throw new Error('experimentId is required for Restate isolation');
  if (!ports || Object.values(ports).some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('complete Restate isolation ports are required');
  }
  return {
    RESTATE_ADMIN_URL: `http://127.0.0.1:${ports.admin}`,
    RESTATE_INGRESS_URL: `http://127.0.0.1:${ports.ingress}`,
    NAIA_RESTATE_ENDPOINT_PORT: String(ports.endpoint),
    NAIA_RESTATE_PUBLIC_ENDPOINT: `http://127.0.0.1:${ports.endpoint}`,
    NAIA_T5_RESTATE_PORT_A: String(ports.t5A),
    NAIA_T5_RESTATE_PORT_B: String(ports.t5B),
    NAIA_T11_RESTATE_PORT_A: String(ports.t11A),
    NAIA_T11_RESTATE_PORT_B: String(ports.t11B),
    NAIA_T12_RESTATE_PORT_A: String(ports.t12A),
    NAIA_T12_RESTATE_PORT_B: String(ports.t12B),
    NAIA_T16_RESTATE_PORT_A: String(ports.t16A),
    NAIA_T16_RESTATE_PORT_B: String(ports.t16B),
    NAIA_RESTATE_FORMAL_NODE_NAME: safeIdentity(`naia-${spec.experimentId}-${spec.randomSeed ?? 'noseed'}`)
  };
}

function runnerBoundarySettled(run) {
  const observation = run?.rawObservations ?? {};
  return Boolean(observation.runnerProcess || observation.process);
}

function mutantUsesProcessScopedOracle(mutantId) {
  return ['T7', 'T8', 'T11'].includes(mutantId);
}

function receiptBase(overrides = {}) {
  return {
    status: 'FAIL',
    workerCleanup: false,
    durableStateCleanup: false,
    oracleCleanup: false,
    temporaryResourcesCleanup: false,
    ...overrides
  };
}

export function createRestateFormalLifecycle({
  repositoryRoot,
  env = process.env,
  timeoutMs = 15000,
  operations = null
} = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const ops = operations ?? defaultOperations();
  const state = {
    workspace: null,
    server: null,
    serverPath: env.NAIA_RESTATE_SERVER ?? null,
    serverSha256: null,
    spec: null,
    ports: null,
    isolationEnv: null
  };

  async function preRunCleanupHook(spec) {
    state.spec = spec;
    try {
      state.workspace = await ops.createWorkspace('naia-restate-formal-');
      const platformIdentity = ops.platformIdentity();
      if (platformIdentity.platform !== RESTATE_FORMAL_PROFILE.platform || platformIdentity.arch !== RESTATE_FORMAL_PROFILE.arch) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'RESTATE_FORMAL_PLATFORM_PROFILE_MISMATCH',
          expectedPlatform: { platform: RESTATE_FORMAL_PROFILE.platform, arch: RESTATE_FORMAL_PROFILE.arch },
          observedPlatform: platformIdentity,
          workspace: state.workspace
        });
      }
      if (!state.serverPath) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'RESTATE_FORMAL_SERVER_PATH_REQUIRED',
          requiredEnv: 'NAIA_RESTATE_SERVER',
          workspace: state.workspace
        });
      }

      state.serverSha256 = await ops.sha256File(state.serverPath);
      const version = await ops.runCommand(state.serverPath, ['--version'], { cwd: repositoryRoot, env });
      const versionText = `${version.stdout ?? ''}\n${version.stderr ?? ''}`;
      if (version.code !== 0 || version.spawnError || !restateVersionMatchesFrozenProfile(versionText)) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'RESTATE_FORMAL_RUNTIME_VERSION_UNVERIFIED',
          server: state.serverPath,
          serverSha256: state.serverSha256,
          versionResult: version,
          expectedProfile: RESTATE_FORMAL_PROFILE,
          workspace: state.workspace
        });
      }

      const allocated = await allocateDistinctPorts(ops, 12);
      state.ports = {
        fabric: allocated[0], admin: allocated[1], ingress: allocated[2], endpoint: allocated[3],
        t5A: allocated[4], t5B: allocated[5], t11A: allocated[6], t11B: allocated[7],
        t12A: allocated[8], t12B: allocated[9], t16A: allocated[10], t16B: allocated[11]
      };
      state.isolationEnv = buildRestateIsolationEnvironment(spec, state.ports);
      Object.assign(env, state.isolationEnv);

      const serverEnv = {
        ...env,
        RESTATE_LISTEN_MODE: 'tcp',
        RESTATE_BIND_ADDRESS: `127.0.0.1:${state.ports.fabric}`,
        RESTATE_ADMIN__BIND_ADDRESS: `127.0.0.1:${state.ports.admin}`,
        RESTATE_INGRESS__BIND_ADDRESS: `127.0.0.1:${state.ports.ingress}`,
        RESTATE_ADVERTISED_HOST: '127.0.0.1',
        RESTATE_NODE_NAME: state.isolationEnv.NAIA_RESTATE_FORMAL_NODE_NAME,
        RESTATE_CLUSTER_NAME: state.isolationEnv.NAIA_RESTATE_FORMAL_NODE_NAME,
        RESTATE_DISABLE_TELEMETRY: 'true'
      };
      delete serverEnv.RESTATE_ADMIN_URL;
      delete serverEnv.RESTATE_INGRESS_URL;

      state.server = ops.startServer(state.serverPath, [
        '--no-logo',
        '--base-dir', state.workspace,
        '--listen-mode', 'tcp'
      ], { cwd: state.workspace, env: serverEnv });

      const healthUrl = `${state.isolationEnv.RESTATE_ADMIN_URL}/health`;
      const deadline = Date.now() + Math.max(5000, timeoutMs);
      let health = null;
      while (Date.now() < deadline) {
        if (state.server?.spawnError) break;
        if (state.server?.pid && !ops.pidAlive(state.server.pid)) break;
        health = await ops.healthCheck(healthUrl);
        if (health?.healthy === true) break;
        await sleep(100);
      }
      if (health?.healthy !== true) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'RESTATE_FORMAL_RUNTIME_NOT_HEALTHY',
          server: state.serverPath,
          serverSha256: state.serverSha256,
          workspace: state.workspace,
          serverPid: state.server?.pid ?? null,
          serverSpawnError: state.server?.spawnError ?? null,
          serverStderr: state.server?.stderr ?? '',
          adminUrl: state.isolationEnv.RESTATE_ADMIN_URL,
          ingressUrl: state.isolationEnv.RESTATE_INGRESS_URL,
          health
        });
      }

      const formalRuntimeIdentity = {
        kind: 'restate-local-server-runtime',
        expectedProfile: RESTATE_FORMAL_PROFILE,
        observedPlatform: platformIdentity,
        serverSha256: state.serverSha256,
        versionOutput: versionText.trim()
      };

      return receiptBase({
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        evidenceId: `${spec.experimentId}:restate-isolated-runtime`,
        isolationBasis: 'fresh base-dir + dedicated Restate server + loopback-only unique server/service ports',
        workspace: state.workspace,
        server: state.serverPath,
        serverSha256: state.serverSha256,
        versionOutput: versionText.trim(),
        expectedProfile: RESTATE_FORMAL_PROFILE,
        observedPlatform: platformIdentity,
        adminUrl: state.isolationEnv.RESTATE_ADMIN_URL,
        ingressUrl: state.isolationEnv.RESTATE_INGRESS_URL,
        serverPid: state.server?.pid ?? null,
        ports: { ...state.ports },
        formalRuntimeIdentity
      });
    } catch (error) {
      return receiptBase({
        workerCleanup: true,
        oracleCleanup: true,
        reason: 'RESTATE_FORMAL_PRE_RUN_LIFECYCLE_ERROR',
        error: String(error),
        workspace: state.workspace,
        serverPid: state.server?.pid ?? null
      });
    }
  }

  async function cleanupHook(_spec, setup, run) {
    const pidCleanup = assessWorkerPidCleanup({
      setupStatus: setup?.status,
      mutantId: state.spec?.mutantId,
      run,
      pidAlive: ops.pidAlive
    });

    let serverCleanup = true;
    if (state.server) {
      try {
        serverCleanup = await ops.stopServer(state.server);
      } catch {
        serverCleanup = false;
      }
    }

    let workspaceCleanup = true;
    if (state.workspace) {
      try {
        await ops.removeWorkspace(state.workspace);
      } catch {
        workspaceCleanup = false;
      }
      if (await ops.pathExists(state.workspace)) workspaceCleanup = false;
    }

    const workerCleanup = pidCleanup.workerCleanup;
    const durableStateCleanup = serverCleanup && workspaceCleanup;
    const oracleCleanup = setup?.status === 'BLOCKED_SETUP' || !mutantUsesProcessScopedOracle(state.spec?.mutantId) || runnerBoundarySettled(run);
    const temporaryResourcesCleanup = workspaceCleanup;
    const allClean = workerCleanup && durableStateCleanup && oracleCleanup && temporaryResourcesCleanup;

    return {
      status: setup?.status === 'BLOCKED_SETUP' ? (allClean ? 'NOT_APPLICABLE' : 'FAIL') : (allClean ? 'PASS' : 'FAIL'),
      workerCleanup,
      durableStateCleanup,
      oracleCleanup,
      temporaryResourcesCleanup,
      candidateLifecycle: 'Restate isolated formal runtime',
      workerPidProvenanceRequired: pidCleanup.provenanceRequired,
      workerPidProvenanceObserved: pidCleanup.provenanceObserved,
      workerProcessPids: pidCleanup.workerProcessPids,
      observedWorkerPids: pidCleanup.observedPids,
      liveObservedWorkerPids: pidCleanup.liveObservedPids,
      restateServerPid: state.server?.pid ?? null,
      restateServerCleanup: serverCleanup,
      workspace: state.workspace,
      workspaceCleanup
    };
  }

  return {
    candidateName: 'Restate',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    declaredEnvNames: RESTATE_FORMAL_ENV_NAMES,
    preRunCleanupHook,
    cleanupHook
  };
}
