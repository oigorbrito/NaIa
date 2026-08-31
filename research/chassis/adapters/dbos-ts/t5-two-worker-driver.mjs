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
  const state = { workerId, executorId, listenQueue, child, pid: child.pid ?? null, events: [], waiters: [], stderr: '', exit: null };
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
  const existing = state.events.find((event) => predicates.some((predicate) => predicate(event)));
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const predicate = (event) => predicates.some((candidate) => candidate(event));
    const waiter = { predicate, resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      state.waiters.splice(state.waiters.indexOf(waiter), 1);
      reject(new Error(`${state.workerId} did not emit ${description} before timeout; stderr=${state.stderr}`));
    }, timeoutMs);
    state.waiters.push(waiter);
  });
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

export async function runDbosT5TwoWorker({
  objectiveId = `naia-dbos-t5-${randomUUID()}`,
  timeoutMs = Number(process.env.NAIA_T5_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!env.DBOS_SYSTEM_DATABASE_URL) throw new Error('DBOS_SYSTEM_DATABASE_URL is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T5 timeout must be a positive number');

  const queueA = 'naia-t5-queue-A';
  const queueB = 'naia-t5-queue-B';
  const executorA = `naia-t5-executor-A-${randomUUID()}`;
  const executorB = `naia-t5-executor-B-${randomUUID()}`;
  const schedule = [];
  let workerA = null;
  let workerB = null;

  try {
    workerA = spawnWorker('worker-A', executorA, queueA, env);
    const readyA = await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    schedule.push('worker-A-ready');

    send(workerA, { command: 'start', objectiveId, queueName: queueA });
    await waitForEvent(workerA, (event) => event.event === 'workflow_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_started');
    await waitForEvent(workerA, (event) => event.event === 'workflow_body_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_body_started');
    schedule.push('worker-A-old-authority');
    const statusA = await queryStatus(workerA, objectiveId, timeoutMs);

    workerB = spawnWorker('worker-B', executorB, queueB, env);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready');
    schedule.push('worker-B-ready');

    send(workerB, { command: 'resume', objectiveId, queueName: queueB });
    await waitForEvent(workerB, (event) => event.event === 'workflow_resumed' && event.objectiveId === objectiveId, timeoutMs, 'workflow_resumed');
    await waitForEvent(workerB, (event) => event.event === 'workflow_body_started' && event.objectiveId === objectiveId, timeoutMs, 'workflow_body_started after resume');
    schedule.push('worker-B-new-authority');
    const statusB = await queryStatus(workerB, objectiveId, timeoutMs);

    const oldAuthorityIdentity = authorityIdentity(objectiveId, statusA);
    const newAuthorityIdentity = authorityIdentity(objectiveId, statusB);

    send(workerA, { command: 'release', objectiveId });
    await waitForEvent(workerA, (event) => event.event === 'workflow_body_released' && event.objectiveId === objectiveId, timeoutMs, 'workflow_body_released');
    schedule.push('worker-A-stale-return-during-B-ownership');

    const staleOutcome = await waitForOneOf(workerA, [
      (event) => event.event === 'stale_outcome_rejected',
      (event) => event.event === 'workflow_handle_result' && event.objectiveId === objectiveId,
      (event) => event.event === 'workflow_handle_error' && event.objectiveId === objectiveId
    ], timeoutMs, 'stale outcome disposition');
    const staleRejected = staleOutcome.event === 'stale_outcome_rejected';
    schedule.push(staleRejected ? 'worker-A-stale-outcome-rejected' : 'worker-A-stale-outcome-not-rejected');

    const postStaleStatus = await queryStatus(workerB, objectiveId, timeoutMs);
    const bStillCurrent =
      postStaleStatus.status?.status === 'PENDING' &&
      postStaleStatus.status?.executorId === executorB;
    schedule.push('post-stale-authority-inspected');

    send(workerB, { command: 'release', objectiveId });
    await waitForEvent(workerB, (event) => event.event === 'workflow_body_released' && event.objectiveId === objectiveId, timeoutMs, 'workflow_body_released');
    const resultB = await waitForEvent(workerB, (event) => event.event === 'workflow_handle_result' && event.objectiveId === objectiveId, timeoutMs, 'workflow_handle_result');
    schedule.push('worker-B-completion-observed');

    const finalStatus = await queryStatus(workerB, objectiveId, timeoutMs);
    schedule.push('final-authority-inspected');

    const finalOrigin = resultB.result?.origin ?? null;
    return {
      oldWorkerIdentity: `dbos-executor:${executorA}:pid:${readyA.pid}`,
      newWorkerIdentity: `dbos-executor:${executorB}:pid:${readyB.pid}`,
      oldAuthorityIdentity,
      newAuthorityIdentity,
      authorityAdvanced:
        statusA.status?.executorId === executorA &&
        statusB.status?.executorId === executorB &&
        oldAuthorityIdentity !== null &&
        newAuthorityIdentity !== null &&
        oldAuthorityIdentity !== newAuthorityIdentity,
      oldAuthorityHeldUntilTakeover: workerA.exit === null,
      staleCompletion: {
        attempted: true,
        attemptedBeforeNewCompletion: true,
        rejectedOrNonAuthoritative: staleRejected && bStillCurrent,
        becameAuthoritative: !staleRejected || !bStillCurrent,
        nativeDisposition: staleOutcome
      },
      newAuthorityStillCurrentAfterStaleAttempt: bStillCurrent,
      newAuthorityCompletion: {
        attempted: true,
        acceptedOrAuthoritative: finalOrigin === 'new-authority' && finalStatus.status?.status === 'SUCCESS',
        result: resultB.result
      },
      finalAuthorityIdentity: finalOrigin === 'new-authority' ? newAuthorityIdentity : null,
      finalResultOrigin: finalOrigin,
      durableAuthorityAlive: Boolean(finalStatus.status),
      deterministicScheduleObserved: schedule.length === 9,
      rawNativeEvidence: {
        objectiveId,
        queueA,
        queueB,
        schedule,
        initialStatus: statusA.status,
        takeoverStatus: statusB.status,
        postStaleStatus: postStaleStatus.status,
        finalStatus: finalStatus.status,
        staleOutcome,
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
  const evidence = await runDbosT5TwoWorker();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'DBOS_T5_TWO_WORKER_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
