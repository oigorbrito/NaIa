import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
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
  const state = { workerId, child, pid: child.pid ?? null, events: [], stderr: '', waiters: [], exit: null };
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

function command(state, value) {
  if (!state.child.stdin.writable) throw new Error(`${state.workerId} command channel closed`);
  state.child.stdin.write(`${JSON.stringify(value)}\n`);
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

export async function runTemporalT12({
  objectiveId = `naia-temporal-t12-${randomUUID()}`,
  address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  namespace = process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue = process.env.NAIA_TEMPORAL_T12_TASK_QUEUE ?? 'naia-chassis-t12-v1',
  timeoutMs = Number(process.env.NAIA_T12_TIMEOUT_MS ?? '20000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T12 timeout must be a positive number');
  const workerEnv = { ...env, TEMPORAL_ADDRESS: address, TEMPORAL_NAMESPACE: namespace, NAIA_TEMPORAL_T5_TASK_QUEUE: taskQueue };
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace, identity: `t12-coordinator:${process.pid}` });
  let workerA = null;
  let workerB = null;
  const schedule = [];

  try {
    workerA = spawnWorker('worker-A', workerEnv);
    await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready A');
    const handle = await client.workflow.start(t5OwnershipWorkflow, {
      workflowId: objectiveId,
      taskQueue,
      args: [{ objectiveId }]
    });

    const attemptA = await waitForEvent(workerA, (event) => event.event === 'activity_attempt_observed' && event.attempt === 1, timeoutMs, 'attempt 1');
    schedule.push('old-authority-acquired');

    command(workerA, { command: 'stop_polling' });
    await waitForEvent(workerA, (event) => event.event === 'worker_polling_stopped', timeoutMs, 'worker_polling_stopped');
    schedule.push('old-completion-held');

    workerB = spawnWorker('worker-B', workerEnv);
    await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready B');
    const attemptB = await waitForEvent(workerB, (event) => event.event === 'activity_attempt_observed' && event.attempt === 2, timeoutMs, 'attempt 2');
    schedule.push('new-authority-acquired');

    command(workerB, { command: 'complete', attempt: 2, origin: 'new-authority' });
    const completionB = await waitForEvent(workerB, (event) => event.event === 'completion_response' && event.attempt === 2, timeoutMs, 'attempt 2 completion');
    const waiting = await waitForWorkflowPhase(handle, 'WAITING_FINAL_RELEASE', timeoutMs);
    schedule.push('new-authority-committed');

    command(workerA, { command: 'complete', attempt: 1, origin: 'old-authority' });
    const completionA = await waitForEvent(workerA, (event) => event.event === 'completion_response' && event.attempt === 1, timeoutMs, 'attempt 1 stale completion');
    schedule.push('stale-completion-submitted');

    await handle.signal(t5ReleaseFinalSignal);
    const workflowResult = await handle.result();
    const description = await handle.describe();
    schedule.push('final-authority-inspected');

    const oldAuthorityIdentity = `temporal-activity-task-token:${attemptA.taskTokenBase64}`;
    const newAuthorityIdentity = `temporal-activity-task-token:${attemptB.taskTokenBase64}`;
    const staleRejected = completionA.accepted === false && completionA.staleRejected === true;
    const finalFromNew = workflowResult?.origin === 'new-authority';

    return {
      oldAuthorityIdentity,
      newAuthorityIdentity,
      authorityAdvanced:
        attemptA.attempt === 1 && attemptB.attempt === 2 &&
        attemptA.taskTokenBase64 !== attemptB.taskTokenBase64 &&
        attemptA.objectiveId === attemptB.objectiveId,
      oldCompletionHeldUntilNewCommit: true,
      newAuthorityCompletion: {
        attempted: true,
        acceptedOrAuthoritative: completionB.accepted === true && waiting.phase === 'WAITING_FINAL_RELEASE',
        response: completionB
      },
      staleCompletion: {
        attempted: true,
        attemptedAfterNewCommit: true,
        rejectedOrNonAuthoritative: staleRejected || finalFromNew,
        becameAuthoritative: !finalFromNew,
        response: completionA
      },
      finalAuthorityIdentity: finalFromNew ? newAuthorityIdentity : null,
      finalResultOrigin: workflowResult?.origin ?? null,
      durableAuthorityAlive: Boolean(description),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify([
        'old-authority-acquired',
        'old-completion-held',
        'new-authority-acquired',
        'new-authority-committed',
        'stale-completion-submitted',
        'final-authority-inspected'
      ]),
      rawNativeEvidence: {
        objectiveId,
        workflowId: handle.workflowId,
        taskQueue,
        schedule,
        oldAttempt: attemptA,
        newAttempt: attemptB,
        newCompletion: completionB,
        staleCompletion: completionA,
        waitingState: waiting,
        workflowResult,
        workflowDescription: description,
        workerA: { pid: workerA.pid, events: workerA.events, stderr: workerA.stderr },
        workerB: { pid: workerB.pid, events: workerB.events, stderr: workerB.stderr }
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB)]);
    await connection.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runTemporalT12();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'TEMPORAL_T12_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
