import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't16-worker-process.mjs');

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  return args;
}

function spawnWorker(workerId, executorId, applicationVersion, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: {
      ...env,
      NAIA_T16_WORKER_ID: workerId,
      NAIA_T16_EXECUTOR_ID: executorId,
      NAIA_T16_APPLICATION_VERSION: applicationVersion
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { workerId, executorId, applicationVersion, child, pid: child.pid ?? null, events: [], waiters: [], exitWaiters: [], stderr: '', exit: null };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { event = { event: 'unparseable_stdout', raw: line }; }
    state.events.push(event);
    for (const waiter of [...state.waiters]) {
      if (waiter.predicate(event)) {
        state.waiters.splice(state.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    }
  });
  child.once('exit', (code, signal) => {
    state.exit = { code, signal };
    for (const waiter of [...state.exitWaiters]) {
      state.exitWaiters.splice(state.exitWaiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(state.exit);
    }
    for (const waiter of [...state.waiters]) {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${workerId} exited before expected event: code=${code} signal=${signal}; stderr=${state.stderr}`));
    }
    rl.close();
  });
  return state;
}

function send(state, command) {
  if (!state.child.stdin.writable) throw new Error(`${state.workerId} command channel closed`);
  state.child.stdin.write(`${JSON.stringify(command)}\n`);
}

function waitForEvent(state, predicate, timeoutMs, description) {
  const existing = state.events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      reject(new Error(`${state.workerId} did not emit ${description} before timeout; stderr=${state.stderr}`));
    }, timeoutMs);
    state.waiters.push(waiter);
  });
}

function waitForExit(state, timeoutMs) {
  if (state.exit) return Promise.resolve(state.exit);
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      state.exitWaiters.splice(state.exitWaiters.indexOf(waiter), 1);
      reject(new Error(`${state.workerId} did not exit before timeout`));
    }, timeoutMs);
    state.exitWaiters.push(waiter);
  });
}

async function queryStatus(state, objectiveId, timeoutMs) {
  const prior = state.events.length;
  send(state, { command: 'status', objectiveId });
  return waitForEvent(
    state,
    (event) => event.event === 'workflow_status' && event.objectiveId === objectiveId && state.events.indexOf(event) >= prior,
    timeoutMs,
    'workflow_status'
  );
}

async function closeWorker(state) {
  if (!state || state.exit) return;
  try { send(state, { command: 'exit' }); } catch {}
  try {
    await waitForExit(state, 5000);
  } catch {
    if (!state.exit) state.child.kill('SIGKILL');
    await waitForExit(state, 5000).catch(() => {});
  }
}

export async function runDbosT16({
  objectiveId = `naia-dbos-t16-${randomUUID()}`,
  beforeVersion = 'naia-t16-v1',
  afterVersion = 'naia-t16-v2',
  timeoutMs = Number(process.env.NAIA_T16_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!env.DBOS_SYSTEM_DATABASE_URL) throw new Error('DBOS_SYSTEM_DATABASE_URL is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T16 timeout must be a positive number');
  if (!beforeVersion || !afterVersion || beforeVersion === afterVersion) throw new Error('T16 requires distinct before/after application versions');

  const stableExecutorId = `naia-t16-executor-${randomUUID()}`;
  const schedule = [];
  let workerA = null;
  let workerB = null;
  let workerC = null;

  try {
    workerA = spawnWorker('worker-A', stableExecutorId, beforeVersion, env);
    await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    send(workerA, { command: 'start', objectiveId });
    await waitForEvent(workerA, (event) => event.event === 'workflow_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_started');
    const checkpointA = await waitForEvent(workerA, (event) => event.event === 'durable_checkpoint_observed' && event.objectiveId === objectiveId, timeoutMs, 'durable_checkpoint_observed');
    const statusBefore = await queryStatus(workerA, objectiveId, timeoutMs);
    schedule.push('durable-objective-under-A');

    const crashWait = waitForExit(workerA, timeoutMs);
    const crashRequested = workerA.child.kill('SIGKILL');
    const crashExit = await crashWait;
    schedule.push('execution-boundary-stopped');

    workerB = spawnWorker('worker-B', stableExecutorId, afterVersion, env);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker-B-ready');
    schedule.push('semantic-dimension-mutated:applicationVersion');
    const statusUnderB = await queryStatus(workerB, objectiveId, timeoutMs);
    const bRecovered = workerB.events.some((event) => event.event === 'durable_checkpoint_observed' && event.objectiveId === objectiveId);
    schedule.push('recovery-under-B-attempted');

    const promotionPrior = workerB.events.length;
    send(workerB, { command: 'promote-version', objectiveId, applicationVersion: beforeVersion });
    const rollbackPromotion = await waitForEvent(
      workerB,
      (event) => event.event === 'application_version_promoted' &&
        event.promotedVersion === beforeVersion &&
        workerB.events.indexOf(event) >= promotionPrior,
      timeoutMs,
      'application_version_promoted'
    );
    schedule.push('rollback-promoted-A-to-latest');

    await closeWorker(workerB);

    workerC = spawnWorker('worker-C', stableExecutorId, beforeVersion, env);
    await waitForEvent(workerC, (event) => event.event === 'worker_ready', timeoutMs, 'worker-C-ready');
    const checkpointC = await waitForEvent(workerC, (event) => event.event === 'durable_checkpoint_observed' && event.objectiveId === objectiveId, timeoutMs, 'compatible recovery checkpoint');
    schedule.push('compatible-profile-recovery-observed');

    send(workerC, { command: 'release', objectiveId });
    await waitForEvent(workerC, (event) => event.event === 'release_ack' && event.objectiveId === objectiveId, timeoutMs, 'release_ack');
    await waitForEvent(workerC, (event) => event.event === 'post_checkpoint_released' && event.objectiveId === objectiveId, timeoutMs, 'post_checkpoint_released');

    const attachPrior = workerC.events.length;
    send(workerC, { command: 'attach', objectiveId });
    await waitForEvent(
      workerC,
      (event) => event.event === 'recovery_attach_attempted' && event.objectiveId === objectiveId && workerC.events.indexOf(event) >= attachPrior,
      timeoutMs,
      'recovery_attach_attempted'
    );
    const resultC = await waitForEvent(
      workerC,
      (event) => ['recovery_attach_result', 'recovery_attach_error'].includes(event.event) && event.objectiveId === objectiveId,
      timeoutMs,
      'compatible recovery result'
    );
    const finalStatus = await queryStatus(workerC, objectiveId, timeoutMs);
    schedule.push('final-state-inspected');

    const retainedBeforeVersionUnderB = statusUnderB.status?.applicationVersion === beforeVersion;
    const explicitRollbackObserved =
      rollbackPromotion.promotedVersion === beforeVersion &&
      rollbackPromotion.latestVersion === beforeVersion;
    const compatibleResult = resultC.event === 'recovery_attach_result' ? resultC.result : null;
    const routedToCompatible =
      readyB.applicationVersion === afterVersion &&
      bRecovered === false &&
      retainedBeforeVersionUnderB &&
      explicitRollbackObserved &&
      checkpointC.applicationVersion === beforeVersion &&
      compatibleResult?.applicationVersion === beforeVersion &&
      finalStatus.status?.status === 'SUCCESS' &&
      finalStatus.status?.applicationVersion === beforeVersion;

    return {
      objectiveIdentity: objectiveId,
      semanticMutation: { dimension: 'applicationVersion', before: beforeVersion, after: afterVersion },
      durableCheckpointBeforeMutation:
        checkpointA.checkpoint?.marker === 't16-durable-checkpoint' &&
        statusBefore.status?.applicationVersion === beforeVersion,
      recoveryAttemptedUnderMutatedProfile: readyB.applicationVersion === afterVersion,
      compatibilityDisposition: {
        kind: routedToCompatible ? 'ROUTED_TO_COMPATIBLE' : 'UNKNOWN',
        explicit: routedToCompatible,
        migrationIdentity: null
      },
      silentSemanticChangeObserved: bRecovered || statusUnderB.status?.applicationVersion === afterVersion,
      priorMeaningPreservedOrExplicitlyMigrated: routedToCompatible,
      durableAuthorityAlive: Boolean(statusUnderB.status) && Boolean(finalStatus.status),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify([
        'durable-objective-under-A',
        'execution-boundary-stopped',
        'semantic-dimension-mutated:applicationVersion',
        'recovery-under-B-attempted',
        'rollback-promoted-A-to-latest',
        'compatible-profile-recovery-observed',
        'final-state-inspected'
      ]),
      rawNativeEvidence: {
        objectiveId,
        stableExecutorId,
        schedule,
        crash: { requested: crashRequested, exit: crashExit },
        statusBefore: statusBefore.status,
        statusUnderMutatedProfile: statusUnderB.status,
        rollbackPromotion,
        finalStatus: finalStatus.status,
        bRecovered,
        checkpointA,
        checkpointC,
        resultC,
        workerA: { pid: workerA.pid, events: workerA.events, stderr: workerA.stderr, exit: workerA.exit },
        workerB: { pid: workerB.pid, events: workerB.events, stderr: workerB.stderr, exit: workerB.exit },
        workerC: { pid: workerC.pid, events: workerC.events, stderr: workerC.stderr, exit: workerC.exit }
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB), closeWorker(workerC)]);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runDbosT16();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'DBOS_T16_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
