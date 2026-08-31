import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't5-worker-process.mjs');

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  return args;
}

function spawnWorker(workerId, executorId, listenQueue, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: { ...env, NAIA_T5_WORKER_ID: workerId, NAIA_T5_EXECUTOR_ID: executorId, NAIA_T5_LISTEN_QUEUE: listenQueue },
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

function waitForOneOf(state, predicates, timeoutMs, description) {
  return waitForEvent(state, (event) => predicates.some((predicate) => predicate(event)), timeoutMs, description);
}

async function queryStatus(state, objectiveId, timeoutMs) {
  const priorCount = state.events.length;
  send(state, { command: 'status', objectiveId });
  return waitForEvent(
    state,
    (event) => event.event === 'workflow_status' && event.objectiveId === objectiveId && state.events.indexOf(event) >= priorCount,
    timeoutMs,
    'workflow_status'
  );
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

function authorityIdentity(objectiveId, statusEvent) {
  const status = statusEvent?.status;
  if (!status?.executorId) return null;
  return `dbos-workflow:${objectiveId}:executor:${status.executorId}:recovery:${status.recoveryAttempts ?? 'unknown'}`;
}

export async function runDbosT12({
  objectiveId = `naia-dbos-t12-${randomUUID()}`,
  timeoutMs = Number(process.env.NAIA_T12_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!env.DBOS_SYSTEM_DATABASE_URL) throw new Error('DBOS_SYSTEM_DATABASE_URL is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T12 timeout must be a positive number');

  const queueA = 'naia-t5-queue-A';
  const queueB = 'naia-t5-queue-B';
  const executorA = `naia-t12-executor-A-${randomUUID()}`;
  const executorB = `naia-t12-executor-B-${randomUUID()}`;
  const schedule = [];
  let workerA = null;
  let workerB = null;

  try {
    workerA = spawnWorker('worker-A', executorA, queueA, env);
    await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    send(workerA, { command: 'start', objectiveId, queueName: queueA });
    await waitForEvent(workerA, (event) => event.event === 'workflow_body_started' && event.objectiveId === objectiveId, timeoutMs, 'old workflow body');
    schedule.push('old-authority-acquired-and-held');
    const statusA = await queryStatus(workerA, objectiveId, timeoutMs);

    workerB = spawnWorker('worker-B', executorB, queueB, env);
    await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    send(workerB, { command: 'resume', objectiveId, queueName: queueB });
    await waitForEvent(workerB, (event) => event.event === 'workflow_body_started' && event.objectiveId === objectiveId, timeoutMs, 'new workflow body');
    schedule.push('new-authority-acquired');
    const statusB = await queryStatus(workerB, objectiveId, timeoutMs);

    const oldAuthorityIdentity = authorityIdentity(objectiveId, statusA);
    const newAuthorityIdentity = authorityIdentity(objectiveId, statusB);

    send(workerB, { command: 'release', objectiveId });
    await waitForEvent(workerB, (event) => event.event === 'workflow_body_released' && event.objectiveId === objectiveId, timeoutMs, 'new workflow release');
    const resultB = await waitForEvent(workerB, (event) => event.event === 'workflow_handle_result' && event.objectiveId === objectiveId, timeoutMs, 'new workflow result');
    const committedStatus = await queryStatus(workerB, objectiveId, timeoutMs);
    schedule.push('new-authority-committed');

    send(workerA, { command: 'release', objectiveId });
    await waitForEvent(workerA, (event) => event.event === 'workflow_body_released' && event.objectiveId === objectiveId, timeoutMs, 'old workflow release');
    const staleDisposition = await waitForOneOf(workerA, [
      (event) => event.event === 'stale_outcome_rejected',
      (event) => event.event === 'workflow_handle_result' && event.objectiveId === objectiveId,
      (event) => event.event === 'workflow_handle_error' && event.objectiveId === objectiveId
    ], timeoutMs, 'stale completion disposition');
    schedule.push('stale-completion-submitted-after-new-commit');

    const finalStatus = await queryStatus(workerB, objectiveId, timeoutMs);
    schedule.push('final-authority-inspected');

    const newCommitted = resultB.result?.origin === 'new-authority' && committedStatus.status?.status === 'SUCCESS';
    const finalStillNew = finalStatus.status?.status === 'SUCCESS' && finalStatus.status?.executorId === executorB;
    const staleExplicitlyRejected = staleDisposition.event === 'stale_outcome_rejected';
    const staleAdoptedNewResult = staleDisposition.event === 'workflow_handle_result' && staleDisposition.result?.origin === 'new-authority';
    const staleNonAuthoritative = finalStillNew && (staleExplicitlyRejected || staleAdoptedNewResult);

    return {
      oldAuthorityIdentity,
      newAuthorityIdentity,
      authorityAdvanced:
        statusA.status?.executorId === executorA &&
        statusB.status?.executorId === executorB &&
        oldAuthorityIdentity !== null &&
        newAuthorityIdentity !== null &&
        oldAuthorityIdentity !== newAuthorityIdentity,
      oldCompletionHeldUntilNewCommit: true,
      newAuthorityCompletion: {
        attempted: true,
        acceptedOrAuthoritative: newCommitted,
        result: resultB.result,
        committedStatus: committedStatus.status
      },
      staleCompletion: {
        attempted: true,
        attemptedAfterNewCommit: newCommitted,
        rejectedOrNonAuthoritative: staleNonAuthoritative,
        becameAuthoritative: !finalStillNew,
        nativeDisposition: staleDisposition
      },
      finalAuthorityIdentity: finalStillNew ? newAuthorityIdentity : null,
      finalResultOrigin: finalStillNew ? 'new-authority' : null,
      durableAuthorityAlive: Boolean(finalStatus.status),
      deterministicScheduleObserved: schedule.length === 5,
      rawNativeEvidence: {
        objectiveId,
        schedule,
        initialStatus: statusA.status,
        takeoverStatus: statusB.status,
        committedStatus: committedStatus.status,
        finalStatus: finalStatus.status,
        staleDisposition,
        workerA: { pid: workerA.pid, executorId: executorA, events: workerA.events, stderr: workerA.stderr },
        workerB: { pid: workerB.pid, executorId: executorB, events: workerB.events, stderr: workerB.stderr }
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB)]);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runDbosT12();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'DBOS_T12_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
