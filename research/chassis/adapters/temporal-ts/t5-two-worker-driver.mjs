import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { t5OwnershipWorkflow, t5ReleaseFinalSignal, t5StatusQuery } from './t5-workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't5-worker-process.mjs');

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function spawnWorker(workerId, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: { ...env, NAIA_T5_WORKER_ID: workerId },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = {
    workerId,
    child,
    pid: child.pid ?? null,
    events: [],
    stderr: '',
    waiters: [],
    exit: null
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { event = { event: 'unparseable_stdout', raw: line, workerId }; }
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

function waitForEvent(state, predicate, timeoutMs, description) {
  const existing = state.events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      reject(new Error(`${state.workerId} did not emit ${description} before timeout; stderr=${state.stderr}`));
    }, timeoutMs);
    const waiter = { predicate, resolve, reject, timer };
    state.waiters.push(waiter);
  });
}

function command(state, value) {
  if (!state.child.stdin.writable) throw new Error(`${state.workerId} command channel is closed`);
  state.child.stdin.write(`${JSON.stringify(value)}\n`);
}

async function waitForWorkflowPhase(handle, expectedPhase, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await handle.query(t5StatusQuery);
    if (last?.phase === expectedPhase) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`workflow did not reach ${expectedPhase}; last=${JSON.stringify(last)}`);
}

async function closeWorker(state) {
  if (!state || state.exit) return;
  try { command(state, { command: 'exit' }); } catch {}
  await new Promise((resolve) => {
    if (state.exit) return resolve();
    const timer = setTimeout(() => {
      if (!state.exit) state.child.kill('SIGKILL');
      resolve();
    }, 5000);
    state.child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export async function runTemporalT5TwoWorker({
  objectiveId = `naia-t5-${randomUUID()}`,
  address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  namespace = process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue = process.env.NAIA_TEMPORAL_T5_TASK_QUEUE ?? 'naia-chassis-t5-v1',
  timeoutMs = Number(process.env.NAIA_T5_TIMEOUT_MS ?? '20000')
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T5 timeout must be a positive number');
  const env = {
    ...process.env,
    TEMPORAL_ADDRESS: address,
    TEMPORAL_NAMESPACE: namespace,
    NAIA_TEMPORAL_T5_TASK_QUEUE: taskQueue
  };
  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection, namespace, identity: `t5-coordinator:${process.pid}` });
  let workerA = null;
  let workerB = null;
  const schedule = [];

  try {
    workerA = spawnWorker('worker-A', env);
    const readyA = await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    schedule.push('worker-A-ready');

    const handle = await client.workflow.start(t5OwnershipWorkflow, {
      workflowId: objectiveId,
      taskQueue,
      args: [{ objectiveId }]
    });

    const attemptA = await waitForEvent(
      workerA,
      (event) => event.event === 'activity_attempt_observed' && event.attempt === 1,
      timeoutMs,
      'activity attempt 1'
    );
    schedule.push('worker-A-old-authority');

    workerB = spawnWorker('worker-B', env);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    schedule.push('worker-B-ready');

    command(workerA, { command: 'stop_polling' });
    await waitForEvent(workerA, (event) => event.event === 'worker_polling_stopped', timeoutMs, 'worker_polling_stopped');
    schedule.push('worker-A-polling-stopped-old-process-alive');

    const attemptB = await waitForEvent(
      workerB,
      (event) => event.event === 'activity_attempt_observed' && event.attempt === 2,
      timeoutMs,
      'activity attempt 2'
    );
    schedule.push('worker-B-new-authority');

    command(workerB, { command: 'complete', attempt: 2, origin: 'new-authority' });
    const completionB = await waitForEvent(
      workerB,
      (event) => event.event === 'completion_response' && event.attempt === 2,
      timeoutMs,
      'attempt 2 completion response'
    );
    schedule.push('worker-B-completion-submitted');

    const waiting = await waitForWorkflowPhase(handle, 'WAITING_FINAL_RELEASE', timeoutMs);
    schedule.push('workflow-confirmed-new-completion-authoritative');

    command(workerA, { command: 'complete', attempt: 1, origin: 'old-authority' });
    const completionA = await waitForEvent(
      workerA,
      (event) => event.event === 'completion_response' && event.attempt === 1,
      timeoutMs,
      'attempt 1 stale completion response'
    );
    schedule.push('worker-A-stale-completion-submitted');

    await handle.signal(t5ReleaseFinalSignal);
    const workflowResult = await handle.result();
    const description = await handle.describe();
    schedule.push('final-authority-inspected');

    const oldAuthorityIdentity = `temporal-activity-task-token:${attemptA.taskTokenBase64}`;
    const newAuthorityIdentity = `temporal-activity-task-token:${attemptB.taskTokenBase64}`;
    return {
      oldWorkerIdentity: `${readyA.workerIdentity}`,
      newWorkerIdentity: `${readyB.workerIdentity}`,
      oldAuthorityIdentity,
      newAuthorityIdentity,
      authorityAdvanced:
        attemptA.attempt === 1 &&
        attemptB.attempt === 2 &&
        attemptA.taskTokenBase64 !== attemptB.taskTokenBase64 &&
        attemptA.objectiveId === attemptB.objectiveId,
      oldAuthorityHeldUntilTakeover: workerA.exit === null,
      newAuthorityCompletion: {
        attempted: true,
        acceptedOrAuthoritative: completionB.accepted === true && waiting.phase === 'WAITING_FINAL_RELEASE',
        response: completionB
      },
      staleCompletion: {
        attempted: true,
        rejectedOrNonAuthoritative: completionA.accepted === false && completionA.staleRejected === true,
        response: completionA
      },
      finalAuthorityIdentity: workflowResult?.origin === 'new-authority' ? newAuthorityIdentity : null,
      finalResultOrigin: workflowResult?.origin ?? null,
      durableAuthorityAlive: Boolean(description),
      deterministicScheduleObserved: schedule.length === 8,
      rawNativeEvidence: {
        objectiveId,
        workflowId: handle.workflowId,
        taskQueue,
        schedule,
        workerA: { pid: workerA.pid, ready: readyA, attempt: attemptA, events: workerA.events, stderr: workerA.stderr },
        workerB: { pid: workerB.pid, ready: readyB, attempt: attemptB, events: workerB.events, stderr: workerB.stderr },
        workflowWaitingState: waiting,
        workflowDescription: description,
        workflowResult
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB)]);
    await clientConnection.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runTemporalT5TwoWorker();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'T5_TWO_WORKER_EVIDENCE_EMITTED', output }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
