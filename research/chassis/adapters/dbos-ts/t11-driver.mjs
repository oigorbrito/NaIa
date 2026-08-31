import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createExternalEffectOracle } from '../../harness/external-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't11-worker-process.mjs');

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  return args;
}

function spawnWorker(workerId, executorId, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: { ...env, NAIA_T11_WORKER_ID: workerId, NAIA_T11_EXECUTOR_ID: executorId },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { workerId, executorId, child, pid: child.pid ?? null, events: [], waiters: [], stderr: '', exit: null };
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

async function closeWorker(state) {
  if (!state || state.exit) return;
  try { send(state, { command: 'exit' }); } catch {}
  await new Promise((resolve) => {
    if (state.exit) return resolve();
    const timer = setTimeout(() => { if (!state.exit) state.child.kill('SIGKILL'); resolve(); }, 5000);
    state.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function launchController(systemDatabaseUrl) {
  DBOS.setConfig({
    name: 'naia-chassis-t11-v1',
    systemDatabaseUrl,
    executorID: `naia-t11-controller-${randomUUID()}`,
    applicationVersion: 'naia-chassis-t11-v1',
    runAdminServer: false
  });
  await DBOS.launch();
}

export async function runDbosT11({
  objectiveId = `naia-dbos-t11-${randomUUID()}`,
  operationId = `naia-dbos-t11-operation-${randomUUID()}`,
  timeoutMs = Number(process.env.NAIA_T11_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!env.DBOS_SYSTEM_DATABASE_URL) throw new Error('DBOS_SYSTEM_DATABASE_URL is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T11 timeout must be a positive number');

  const stableExecutorId = `naia-t11-executor-${randomUUID()}`;
  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  const schedule = [];
  let workerA = null;
  let workerB = null;
  let controllerLaunched = false;

  try {
    workerA = spawnWorker('worker-A', stableExecutorId, env);
    const readyA = await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    send(workerA, { command: 'start', objectiveId, operationId, oracleUrl });
    await waitForEvent(workerA, (event) => event.event === 'workflow_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_started');
    schedule.push('objective-running');
    await waitForEvent(workerA, (event) => event.event === 'pre_cancel_checkpoint' && event.objectiveId === objectiveId, timeoutMs, 'pre_cancel_checkpoint');
    schedule.push('pre-cancel-checkpoint');

    await launchController(env.DBOS_SYSTEM_DATABASE_URL);
    controllerLaunched = true;
    schedule.push('cancel-submitted');
    await DBOS.cancelWorkflow(objectiveId);
    const cancelledStatus = await DBOS.getWorkflowStatus(objectiveId);
    if (cancelledStatus?.status !== 'CANCELLED') {
      throw new Error(`DBOS T11 cancellation did not become durable: ${JSON.stringify(cancelledStatus)}`);
    }
    schedule.push('cancel-authority-durable');
    await DBOS.shutdown();
    controllerLaunched = false;

    const oldWorkerIdentity = `dbos-worker:${readyA.pid}:executor:${stableExecutorId}`;
    const crashInjected = workerA.child.kill('SIGKILL');
    await new Promise((resolve) => workerA.child.once('exit', resolve));
    schedule.push('worker-crash');

    workerB = spawnWorker('worker-B', stableExecutorId, env);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    const recoveryWorkerIdentity = `dbos-worker:${readyB.pid}:executor:${stableExecutorId}`;
    send(workerB, { command: 'attach', objectiveId });
    await waitForEvent(workerB, (event) => event.event === 'recovery_attach_attempted' && event.objectiveId === objectiveId, timeoutMs, 'recovery_attach_attempted');
    schedule.push('recovery-attempted');

    const recoveryDisposition = await waitForEvent(
      workerB,
      (event) => ['recovery_blocked_by_cancellation', 'recovery_attach_result', 'recovery_attach_error'].includes(event.event) && event.objectiveId === objectiveId,
      timeoutMs,
      'recovery disposition'
    );
    const blockedByNativeCancellation = recoveryDisposition.event === 'recovery_blocked_by_cancellation';
    schedule.push('post-cancel-progress-challenged');

    send(workerB, { command: 'status', objectiveId });
    const finalStatusEvent = await waitForEvent(workerB, (event) => event.event === 'workflow_status' && event.objectiveId === objectiveId, timeoutMs, 'workflow_status');
    schedule.push('post-recovery-state-inspected');

    const oracleEntry = oracle.snapshot(operationId);
    const acceptedCountAfterCancel = oracleEntry?.applyCount ?? 0;
    const expectedSchedule = [
      'objective-running',
      'pre-cancel-checkpoint',
      'cancel-submitted',
      'cancel-authority-durable',
      'worker-crash',
      'recovery-attempted',
      'post-cancel-progress-challenged',
      'post-recovery-state-inspected'
    ];

    return {
      objectiveIdentity: objectiveId,
      oldWorkerIdentity,
      recoveryWorkerIdentity,
      cancelSubmission: { attempted: true, acknowledged: true },
      cancelAuthority: { durable: cancelledStatus?.status === 'CANCELLED', nativeState: cancelledStatus?.status ?? null, native: cancelledStatus },
      crash: { injected: crashInjected === true, targetIdentity: oldWorkerIdentity, signal: 'SIGKILL' },
      recovery: { attempted: true, disposition: recoveryDisposition },
      postCancelProtectedOperation: {
        attempted: acceptedCountAfterCancel > 0,
        blockedBeforeProtectedOperation: acceptedCountAfterCancel === 0,
        blockedByNativeCancellation,
        accepted: acceptedCountAfterCancel > 0,
        acceptedCountAfterCancel,
        oracleEntry
      },
      finalCancellationAuthoritative: finalStatusEvent.status?.status === 'CANCELLED',
      durableAuthorityAlive: Boolean(finalStatusEvent.status),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify(expectedSchedule),
      rawNativeEvidence: {
        objectiveId,
        operationId,
        stableExecutorId,
        schedule,
        cancelledStatus,
        finalStatus: finalStatusEvent.status,
        recoveryDisposition,
        workerA: { pid: readyA.pid, events: workerA.events, stderr: workerA.stderr, exit: workerA.exit },
        workerB: { pid: readyB.pid, events: workerB.events, stderr: workerB.stderr, exit: workerB.exit },
        oracleEntry
      }
    };
  } finally {
    if (controllerLaunched && DBOS.isInitialized()) await DBOS.shutdown().catch(() => {});
    await Promise.all([closeWorker(workerA), closeWorker(workerB)]);
    await oracle.stop().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runDbosT11();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'DBOS_T11_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
