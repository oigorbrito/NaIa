import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assessWorkerPidCleanup } from './formal-worker-pid-provenance.mjs';

export const TEMPORAL_FORMAL_PROFILE = Object.freeze({
  sdkVersion: '1.23.0',
  cliVersion: '1.8.1',
  serverVersion: '1.31.2',
  platform: 'linux',
  arch: 'x64',
  cliSha256: 'b94417b9a8760b30217f4b881dabce4b16a76a38b5e99e2eca3ce358b8030f06'
});

export const TEMPORAL_FORMAL_ENV_NAMES = Object.freeze([
  'NAIA_TEMPORAL_CLI',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'NAIA_TEMPORAL_TASK_QUEUE',
  'NAIA_TEMPORAL_T5_TASK_QUEUE',
  'NAIA_TEMPORAL_T11_TASK_QUEUE',
  'NAIA_TEMPORAL_T12_TASK_QUEUE',
  'NAIA_TEMPORAL_T16_TASK_QUEUE'
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
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
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
    sleep(3000).then(() => false)
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
    pidAlive
  };
}

export function temporalVersionMatchesFrozenProfile(text) {
  return /\b1\.8\.1\b/.test(String(text ?? '')) && /Server\s+1\.31\.2\b/.test(String(text ?? ''));
}

function safeIdentity(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 180);
}

export function buildTemporalIsolationEnvironment(spec, address) {
  if (!spec?.experimentId) throw new Error('experimentId is required for Temporal isolation');
  if (!address) throw new Error('Temporal address is required for isolation');
  const prefix = safeIdentity(`naia-formal-${spec.experimentId}-${spec.randomSeed ?? 'noseed'}`);
  return {
    TEMPORAL_ADDRESS: address,
    TEMPORAL_NAMESPACE: 'default',
    NAIA_TEMPORAL_TASK_QUEUE: `${prefix}-common`,
    NAIA_TEMPORAL_T5_TASK_QUEUE: `${prefix}-t5`,
    NAIA_TEMPORAL_T11_TASK_QUEUE: `${prefix}-t11`,
    NAIA_TEMPORAL_T12_TASK_QUEUE: `${prefix}-t12`,
    NAIA_TEMPORAL_T16_TASK_QUEUE: `${prefix}-t16`
  };
}

export function collectObservedPids(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (Number.isInteger(value.pid) && value.pid > 0 && value.pid !== process.pid) output.add(value.pid);
  if (Array.isArray(value)) {
    for (const item of value) collectObservedPids(item, output);
    return output;
  }
  for (const nested of Object.values(value)) collectObservedPids(nested, output);
  return output;
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

function createTemporalLifecycle({ repositoryRoot, env, timeoutMs, operations }) {
  const ops = operations ?? defaultOperations();
  const state = {
    workspace: null,
    sqlitePath: null,
    server: null,
    address: null,
    isolationEnv: null,
    spec: null,
    cli: env.NAIA_TEMPORAL_CLI ?? null,
    cliSha256: null
  };

  async function preRunCleanupHook(spec) {
    state.spec = spec;
    try {
      const workspace = await ops.createWorkspace('naia-temporal-formal-');
      state.workspace = workspace;
      state.sqlitePath = path.join(workspace, 'temporal.sqlite');
      const sqliteExistedBeforeStart = await ops.pathExists(state.sqlitePath);
      if (sqliteExistedBeforeStart) {
        return receiptBase({
          reason: 'TEMPORAL_FORMAL_SQLITE_NOT_FRESH',
          workspace,
          sqlitePath: state.sqlitePath
        });
      }

      const platformIdentity = ops.platformIdentity();
      if (platformIdentity.platform !== TEMPORAL_FORMAL_PROFILE.platform || platformIdentity.arch !== TEMPORAL_FORMAL_PROFILE.arch) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'TEMPORAL_FORMAL_PLATFORM_PROFILE_MISMATCH',
          expectedPlatform: { platform: TEMPORAL_FORMAL_PROFILE.platform, arch: TEMPORAL_FORMAL_PROFILE.arch },
          observedPlatform: platformIdentity
        });
      }
      if (!state.cli) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'TEMPORAL_FORMAL_CLI_PATH_REQUIRED',
          requiredEnv: 'NAIA_TEMPORAL_CLI'
        });
      }

      state.cliSha256 = await ops.sha256File(state.cli);
      if (state.cliSha256 !== TEMPORAL_FORMAL_PROFILE.cliSha256) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'TEMPORAL_FORMAL_CLI_DIGEST_MISMATCH',
          cli: state.cli,
          expectedSha256: TEMPORAL_FORMAL_PROFILE.cliSha256,
          observedSha256: state.cliSha256
        });
      }

      const version = await ops.runCommand(state.cli, ['--version'], { cwd: repositoryRoot, env });
      const versionText = `${version.stdout ?? ''}\n${version.stderr ?? ''}`;
      if (version.code !== 0 || version.spawnError || !temporalVersionMatchesFrozenProfile(versionText)) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'TEMPORAL_FORMAL_RUNTIME_VERSION_UNVERIFIED',
          cli: state.cli,
          cliSha256: state.cliSha256,
          versionResult: version,
          expectedProfile: TEMPORAL_FORMAL_PROFILE
        });
      }

      const port = await ops.allocatePort();
      state.address = `127.0.0.1:${port}`;
      state.isolationEnv = buildTemporalIsolationEnvironment(spec, state.address);
      Object.assign(env, state.isolationEnv);

      state.server = ops.startServer(state.cli, [
        'server', 'start-dev', '--headless', '--ip', '127.0.0.1', '--port', String(port),
        '--db-filename', state.sqlitePath, '--log-level', 'warn'
      ], { cwd: workspace, env });

      const deadline = Date.now() + Math.max(5000, timeoutMs);
      let healthy = false;
      let lastHealth = null;
      while (Date.now() < deadline) {
        if (state.server?.spawnError) break;
        if (state.server?.pid && !ops.pidAlive(state.server.pid)) break;
        lastHealth = await ops.runCommand(state.cli, [
          'operator', 'cluster', 'health', '--address', state.address
        ], { cwd: workspace, env });
        if (lastHealth.code === 0) {
          healthy = true;
          break;
        }
        await sleep(100);
      }
      if (!healthy) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'TEMPORAL_FORMAL_RUNTIME_NOT_HEALTHY',
          workspace,
          sqlitePath: state.sqlitePath,
          address: state.address,
          serverPid: state.server?.pid ?? null,
          serverSpawnError: state.server?.spawnError ?? null,
          serverStderr: state.server?.stderr ?? '',
          lastHealth
        });
      }

      return receiptBase({
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        evidenceId: `${spec.experimentId}:temporal-isolated-runtime`,
        isolationBasis: 'fresh SQLite durable store + experiment-unique task queues + process-scoped oracle',
        workspace,
        sqlitePath: state.sqlitePath,
        sqliteExistedBeforeStart,
        cli: state.cli,
        cliSha256: state.cliSha256,
        versionOutput: versionText.trim(),
        expectedProfile: TEMPORAL_FORMAL_PROFILE,
        observedPlatform: platformIdentity,
        address: state.address,
        serverPid: state.server?.pid ?? null,
        taskQueues: state.isolationEnv
      });
    } catch (error) {
      return receiptBase({
        workerCleanup: true,
        oracleCleanup: true,
        reason: 'TEMPORAL_FORMAL_PRE_RUN_LIFECYCLE_ERROR',
        error: String(error),
        workspace: state.workspace,
        address: state.address,
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
    const observedPids = pidCleanup.observedPids;
    const liveObservedPids = pidCleanup.liveObservedPids;

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

    const sqliteCleanup = state.sqlitePath ? !(await ops.pathExists(state.sqlitePath)) : true;
    const workerCleanup = pidCleanup.workerCleanup;
    const durableStateCleanup = serverCleanup && sqliteCleanup && workspaceCleanup;
    const oracleCleanup = setup?.status === 'BLOCKED_SETUP' || !mutantUsesProcessScopedOracle(state.spec?.mutantId) || runnerBoundarySettled(run);
    const temporaryResourcesCleanup = workspaceCleanup;
    const allClean = workerCleanup && durableStateCleanup && oracleCleanup && temporaryResourcesCleanup;

    return {
      status: setup?.status === 'BLOCKED_SETUP' ? (allClean ? 'NOT_APPLICABLE' : 'FAIL') : (allClean ? 'PASS' : 'FAIL'),
      workerCleanup,
      durableStateCleanup,
      oracleCleanup,
      temporaryResourcesCleanup,
      candidateLifecycle: 'Temporal TypeScript isolated formal runtime',
      workerPidProvenanceRequired: pidCleanup.provenanceRequired,
      workerPidProvenanceObserved: pidCleanup.provenanceObserved,
      workerProcessPids: pidCleanup.workerProcessPids,
      observedWorkerPids: observedPids,
      liveObservedWorkerPids,
      temporalServerPid: state.server?.pid ?? null,
      temporalServerCleanup: serverCleanup,
      sqlitePath: state.sqlitePath,
      sqliteCleanup,
      workspace: state.workspace,
      workspaceCleanup
    };
  }

  return {
    candidateName: 'Temporal TypeScript',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    declaredEnvNames: TEMPORAL_FORMAL_ENV_NAMES,
    preRunCleanupHook,
    cleanupHook
  };
}

export function createFormalRuntimeLifecycle({
  candidateName,
  repositoryRoot,
  env = process.env,
  timeoutMs = 15000,
  operations = null
} = {}) {
  if (candidateName !== 'Temporal TypeScript') return null;
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  return createTemporalLifecycle({ repositoryRoot, env, timeoutMs, operations });
}
