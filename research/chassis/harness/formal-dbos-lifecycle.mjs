import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DBOS_FORMAL_PROFILE = Object.freeze({
  sdkVersion: '4.27.6',
  platform: 'linux',
  arch: 'x64',
  postgresImage: 'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297',
  postgresDigest: 'sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297'
});

export const DBOS_FORMAL_ENV_NAMES = Object.freeze([
  'NAIA_DOCKER_CLI',
  'DBOS_SYSTEM_DATABASE_URL'
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

async function waitForTcp(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(500, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
    if (connected) return true;
    await sleep(100);
  }
  return false;
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

function defaultOperations() {
  return {
    createWorkspace: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
    pathExists,
    platformIdentity: () => ({ platform: process.platform, arch: process.arch }),
    allocatePort: allocateLoopbackPort,
    runCommand,
    waitForTcp,
    removeWorkspace: (workspace) => rm(workspace, { recursive: true, force: true }),
    pidAlive
  };
}

function safeIdentity(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 120);
}

function collectObservedPids(value, output = new Set()) {
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

export function createDbosFormalLifecycle({
  repositoryRoot,
  env,
  timeoutMs = 15000,
  operations = null
} = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  if (!env || typeof env !== 'object') throw new Error('env object is required');
  const ops = operations ?? defaultOperations();
  const state = {
    spec: null,
    workspace: null,
    docker: env.NAIA_DOCKER_CLI || 'docker',
    containerName: null,
    containerId: null,
    port: null,
    databaseUrl: null,
    imageIdentity: null
  };

  async function preRunCleanupHook(spec) {
    state.spec = spec;
    try {
      state.workspace = await ops.createWorkspace('naia-dbos-formal-');
      const platformIdentity = ops.platformIdentity();
      if (platformIdentity.platform !== DBOS_FORMAL_PROFILE.platform || platformIdentity.arch !== DBOS_FORMAL_PROFILE.arch) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_PLATFORM_PROFILE_MISMATCH',
          expectedPlatform: { platform: DBOS_FORMAL_PROFILE.platform, arch: DBOS_FORMAL_PROFILE.arch },
          observedPlatform: platformIdentity
        });
      }

      const dockerVersion = await ops.runCommand(state.docker, ['--version'], { cwd: repositoryRoot, env });
      if (dockerVersion.code !== 0 || dockerVersion.spawnError) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_DOCKER_UNAVAILABLE',
          docker: state.docker,
          dockerVersion
        });
      }

      state.containerName = safeIdentity(`naia-dbos-formal-${spec.experimentId}-${spec.randomSeed ?? 'noseed'}`);
      const preexisting = await ops.runCommand(state.docker, ['inspect', state.containerName], { cwd: state.workspace, env });
      if (preexisting.code === 0) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_PREEXISTING_CONTAINER',
          containerName: state.containerName
        });
      }

      const pull = await ops.runCommand(state.docker, ['pull', DBOS_FORMAL_PROFILE.postgresImage], { cwd: state.workspace, env });
      if (pull.code !== 0 || pull.spawnError) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_POSTGRES_PULL_FAILED',
          image: DBOS_FORMAL_PROFILE.postgresImage,
          pull
        });
      }

      const imageIdentity = await ops.runCommand(state.docker, [
        'image', 'inspect', DBOS_FORMAL_PROFILE.postgresImage, '--format', '{{json .RepoDigests}} {{.Id}}'
      ], { cwd: state.workspace, env });
      state.imageIdentity = `${imageIdentity.stdout ?? ''}\n${imageIdentity.stderr ?? ''}`.trim();
      if (imageIdentity.code !== 0 || !state.imageIdentity.includes(DBOS_FORMAL_PROFILE.postgresDigest)) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_POSTGRES_DIGEST_UNVERIFIED',
          expectedDigest: DBOS_FORMAL_PROFILE.postgresDigest,
          imageIdentity
        });
      }

      state.port = await ops.allocatePort();
      const started = await ops.runCommand(state.docker, [
        'run', '-d', '--name', state.containerName,
        '-e', 'POSTGRES_USER=postgres',
        '-e', 'POSTGRES_PASSWORD=postgres',
        '-e', 'POSTGRES_DB=naia_chassis',
        '-p', `127.0.0.1:${state.port}:5432`,
        DBOS_FORMAL_PROFILE.postgresImage
      ], { cwd: state.workspace, env });
      if (started.code !== 0 || started.spawnError || !String(started.stdout ?? '').trim()) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_POSTGRES_START_FAILED',
          containerName: state.containerName,
          startResult: started
        });
      }
      state.containerId = String(started.stdout).trim();

      const ready = await ops.waitForTcp('127.0.0.1', state.port, Math.max(5000, timeoutMs));
      if (!ready) {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_POSTGRES_NOT_READY',
          containerName: state.containerName,
          containerId: state.containerId,
          port: state.port
        });
      }

      const running = await ops.runCommand(state.docker, [
        'inspect', '--format', '{{.State.Running}}', state.containerName
      ], { cwd: state.workspace, env });
      if (running.code !== 0 || String(running.stdout ?? '').trim() !== 'true') {
        return receiptBase({
          workerCleanup: true,
          oracleCleanup: true,
          reason: 'DBOS_FORMAL_POSTGRES_CONTAINER_NOT_RUNNING',
          containerName: state.containerName,
          inspectResult: running
        });
      }

      state.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${state.port}/naia_chassis`;
      env.DBOS_SYSTEM_DATABASE_URL = state.databaseUrl;

      return receiptBase({
        status: 'PASS',
        workerCleanup: true,
        durableStateCleanup: true,
        oracleCleanup: true,
        temporaryResourcesCleanup: true,
        evidenceId: `${spec.experimentId}:dbos-isolated-postgres`,
        isolationBasis: 'fresh digest-pinned PostgreSQL container without shared volume + experiment-specific container identity + process-scoped oracle',
        workspace: state.workspace,
        docker: state.docker,
        dockerVersion: String(dockerVersion.stdout ?? '').trim(),
        postgresImage: DBOS_FORMAL_PROFILE.postgresImage,
        postgresImageIdentity: state.imageIdentity,
        containerName: state.containerName,
        containerId: state.containerId,
        databaseUrlRedacted: `postgresql://postgres:***@127.0.0.1:${state.port}/naia_chassis`,
        observedPlatform: platformIdentity
      });
    } catch (error) {
      return receiptBase({
        workerCleanup: true,
        oracleCleanup: true,
        reason: 'DBOS_FORMAL_PRE_RUN_LIFECYCLE_ERROR',
        error: String(error),
        workspace: state.workspace,
        containerName: state.containerName
      });
    }
  }

  async function cleanupHook(_spec, setup, run) {
    const observedPids = [...collectObservedPids(run?.rawObservations ?? {})];
    const liveObservedPids = observedPids.filter((pid) => ops.pidAlive(pid));
    const workerCleanup = liveObservedPids.length === 0;

    let databaseDrop = true;
    let databaseAbsent = true;
    let containerCleanup = true;
    let removeResult = null;
    if (state.containerName) {
      const present = await ops.runCommand(state.docker, ['inspect', state.containerName], { cwd: state.workspace ?? repositoryRoot, env });
      if (present.code === 0) {
        const drop = await ops.runCommand(state.docker, [
          'exec', state.containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
          '-c', 'DROP DATABASE IF EXISTS naia_chassis WITH (FORCE);'
        ], { cwd: state.workspace ?? repositoryRoot, env });
        databaseDrop = drop.code === 0;
        const count = await ops.runCommand(state.docker, [
          'exec', state.containerName, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
          "SELECT count(*) FROM pg_database WHERE datname='naia_chassis';"
        ], { cwd: state.workspace ?? repositoryRoot, env });
        databaseAbsent = count.code === 0 && String(count.stdout ?? '').trim() === '0';
        removeResult = await ops.runCommand(state.docker, ['rm', '-f', state.containerName], { cwd: state.workspace ?? repositoryRoot, env });
        containerCleanup = removeResult.code === 0;
      }
      const after = await ops.runCommand(state.docker, ['inspect', state.containerName], { cwd: state.workspace ?? repositoryRoot, env });
      if (after.code === 0) containerCleanup = false;
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

    const durableStateCleanup = databaseDrop && databaseAbsent && containerCleanup;
    const oracleCleanup = setup?.status === 'BLOCKED_SETUP' || !mutantUsesProcessScopedOracle(state.spec?.mutantId) || runnerBoundarySettled(run);
    const temporaryResourcesCleanup = containerCleanup && workspaceCleanup;
    const allClean = workerCleanup && durableStateCleanup && oracleCleanup && temporaryResourcesCleanup;

    return {
      status: setup?.status === 'BLOCKED_SETUP' ? (allClean ? 'NOT_APPLICABLE' : 'FAIL') : (allClean ? 'PASS' : 'FAIL'),
      workerCleanup,
      durableStateCleanup,
      oracleCleanup,
      temporaryResourcesCleanup,
      candidateLifecycle: 'DBOS TypeScript isolated formal PostgreSQL runtime',
      observedWorkerPids: observedPids,
      liveObservedWorkerPids,
      containerName: state.containerName,
      containerId: state.containerId,
      databaseDrop,
      databaseAbsent,
      postgresContainerCleanup: containerCleanup,
      containerRemoveResult: removeResult,
      workspace: state.workspace,
      workspaceCleanup
    };
  }

  return {
    candidateName: 'DBOS TypeScript',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    declaredEnvNames: DBOS_FORMAL_ENV_NAMES,
    preRunCleanupHook,
    cleanupHook
  };
}
