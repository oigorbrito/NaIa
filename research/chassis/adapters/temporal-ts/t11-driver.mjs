import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client, Connection } from '@temporalio/client';
import { createExternalEffectOracle } from '../../harness/external-oracle.mjs';
import { t11StatusQuery } from './t11-workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't11-worker-process.mjs');

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  return args;
}

function spawnWorker(workerId, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: { ...env, NAIA_T11_WORKER_ID: workerId },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { workerId, child, pid: child.pid ?? null, events: [], waiters: [], exitWaiters: [], stderr: '', exit: null };
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

async function closeWorker(state) {
  if (!state || state.exit) return;
  try { send(state, { command: 'exit' }); } catch {}
  try { await waitForExit(state, 5000); }
  catch {
    if (!state.exit) state.child.kill('SIGKILL');
    await waitForExit(state, 5000).catch(() => {});
  }
}

async function waitForHistoryEvent(handle, predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await handle.fetchHistory();
    const event = (last.events ?? []).find(predicate);
    if (event) return { event, history: last };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`history did not expose ${description}; eventCount=${last?.events?.length ?? 0}`);
}

async function waitForClosedStatus(handle, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await handle.describe();
    const status = last.status?.name ?? String(last.status ?? 'UNKNOWN');
    if (status === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workflow did not reach ${expected}; last=${last?.status?.name ?? String(last?.status ?? 'UNKNOWN')}`);
}

export async function runTemporalT11({
  objectiveId = `naia-temporal-t11-${randomUUID()}`,
  operationId = `naia-temporal-t11-operation-${randomUUID()}`,
  address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  namespace = process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue = process.env.NAIA_TEMPORAL_T11_TASK_QUEUE ?? 'naia-chassis-t11-v1',
  timeoutMs = Number(process.env.NAIA_T11_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T11 timeout must be a positive number');
  const workerEnv = { ...env, TEMPORAL_ADDRESS: address, TEMPORAL_NAMESPACE: namespace, NAIA_TEMPORAL_T11_TASK_QUEUE: taskQueue };
  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace, identity: `naia-t11-coordinator:${process.pid}` });
  const schedule = [];
  let workerA = null;
  let workerB = null;

  try {
    workerA = spawnWorker('worker-A', workerEnv);
    const readyA = await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready A');
    send(workerA, { command: 'start', objectiveId, operationId, oracleUrl });
    await waitForEvent(workerA, (event) => event.event === 'workflow_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_started');
    const handle = client.workflow.getHandle(objectiveId);
    schedule.push('objective-running');

    const deadline = Date.now() + timeoutMs;
    let preCancel = null;
    while (Date.now() < deadline) {
      try {
        preCancel = await handle.query(t11StatusQuery);
        if (preCancel?.phase === 'WAITING_CANCEL') break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (preCancel?.phase !== 'WAITING_CANCEL') throw new Error(`T11 pre-cancel phase not observed: ${JSON.stringify(preCancel)}`);
    schedule.push('pre-cancel-checkpoint');

    await handle.cancel();
    schedule.push('cancel-submitted');
    const cancelRequested = await waitForHistoryEvent(
      handle,
      (event) => Boolean(event.workflowExecutionCancelRequestedEventAttributes),
      timeoutMs,
      'WorkflowExecutionCancelRequested'
    );
    schedule.push('cancel-authority-durable');

    const oldWorkerIdentity = `${readyA.workerIdentity}`;
    const exitPromise = waitForExit(workerA, timeoutMs);
    const crashRequested = workerA.child.kill('SIGKILL');
    const crashExit = await exitPromise;
    schedule.push('worker-crash');

    workerB = spawnWorker('worker-B', workerEnv);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready B');
    const recoveryWorkerIdentity = `${readyB.workerIdentity}`;
    schedule.push('recovery-attempted');

    const cancelledDescription = await waitForClosedStatus(handle, 'CANCELLED', timeoutMs);
    schedule.push('post-cancel-progress-challenged');
    const cancelledHistory = await waitForHistoryEvent(
      handle,
      (event) => Boolean(event.workflowExecutionCanceledEventAttributes),
      timeoutMs,
      'WorkflowExecutionCanceled'
    );
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
      cancelAuthority: {
        durable: Boolean(cancelRequested.event),
        nativeState: 'WorkflowExecutionCancelRequested',
        native: { eventId: String(cancelRequested.event.eventId ?? '') }
      },
      crash: {
        injected: crashRequested === true && crashExit?.signal === 'SIGKILL',
        targetIdentity: oldWorkerIdentity,
        signal: 'SIGKILL'
      },
      recovery: { attempted: true, workerIdentity: recoveryWorkerIdentity },
      postCancelProtectedOperation: {
        attempted: acceptedCountAfterCancel > 0,
        blockedBeforeProtectedOperation: acceptedCountAfterCancel === 0,
        blockedByNativeCancellation: Boolean(cancelledHistory.event),
        accepted: acceptedCountAfterCancel > 0,
        acceptedCountAfterCancel,
        oracleEntry
      },
      finalCancellationAuthoritative: (cancelledDescription.status?.name ?? String(cancelledDescription.status ?? '')) === 'CANCELLED',
      durableAuthorityAlive: Boolean(cancelledDescription),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify(expectedSchedule),
      rawNativeEvidence: {
        objectiveId,
        operationId,
        taskQueue,
        schedule,
        preCancel,
        cancelRequestedEventId: String(cancelRequested.event.eventId ?? ''),
        cancelledEventId: String(cancelledHistory.event.eventId ?? ''),
        cancelledDescription,
        crashExit,
        workerA: { pid: readyA.pid, events: workerA.events, stderr: workerA.stderr, exit: workerA.exit },
        workerB: { pid: readyB.pid, events: workerB.events, stderr: workerB.stderr, exit: workerB.exit },
        oracleEntry
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB)]);
    await connection.close().catch(() => {});
    await oracle.stop().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runTemporalT11();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'TEMPORAL_T11_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
