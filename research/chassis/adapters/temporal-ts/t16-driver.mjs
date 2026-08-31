import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client, Connection } from '@temporalio/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(here, 't16-worker-process.mjs');
const workflowAPath = path.join(here, 't16-workflow-a.mjs');
const workflowBPath = path.join(here, 't16-workflow-b.mjs');

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);
  return args;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function spawnWorker(workerId, semanticProfile, env) {
  const child = spawn(process.execPath, [workerScript], {
    cwd: here,
    env: { ...env, NAIA_T16_WORKER_ID: workerId, NAIA_T16_SEMANTIC_PROFILE: semanticProfile },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { workerId, semanticProfile, child, pid: child.pid ?? null, events: [], waiters: [], exitWaiters: [], stderr: '', exit: null };
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
  try {
    await waitForExit(state, 5000);
  } catch {
    if (!state.exit) state.child.kill('SIGKILL');
    await waitForExit(state, 5000).catch(() => {});
  }
}

async function waitForHistory(handle, predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastHistory = null;
  while (Date.now() < deadline) {
    lastHistory = await handle.fetchHistory();
    const value = predicate(lastHistory);
    if (value) return { value, history: lastHistory };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`history did not expose ${description} before timeout; lastEventCount=${lastHistory?.events?.length ?? 0}`);
}

export async function runTemporalT16({
  objectiveId = `naia-temporal-t16-${randomUUID()}`,
  address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  namespace = process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue = process.env.NAIA_TEMPORAL_T16_TASK_QUEUE ?? 'naia-chassis-t16-v1',
  timeoutMs = Number(process.env.NAIA_T16_TIMEOUT_MS ?? '30000'),
  env = process.env
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T16 timeout must be a positive number');

  const beforeSha = sha256(await readFile(workflowAPath));
  const afterSha = sha256(await readFile(workflowBPath));
  if (beforeSha === afterSha) throw new Error('T16 workflow profiles must differ');

  const workerEnv = {
    ...env,
    TEMPORAL_ADDRESS: address,
    TEMPORAL_NAMESPACE: namespace,
    NAIA_TEMPORAL_T16_TASK_QUEUE: taskQueue
  };
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace, identity: `naia-t16-coordinator:${process.pid}` });
  const schedule = [];
  let workerA = null;
  let workerB = null;
  let workerC = null;

  try {
    workerA = spawnWorker('worker-A', 'A', workerEnv);
    await waitForEvent(workerA, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready A');
    const handle = await client.workflow.start('t16VersionedWorkflow', {
      workflowId: objectiveId,
      taskQueue,
      args: [{ objectiveId }]
    });

    const checkpoint = await waitForHistory(handle, (history) => {
      const events = history.events ?? [];
      const timer = events.find((event) => event.timerFiredEventAttributes);
      if (!timer) return null;
      const completedAfterTimer = events.find((event) =>
        event.workflowTaskCompletedEventAttributes && Number(event.eventId ?? 0) > Number(timer.eventId ?? 0)
      );
      return completedAfterTimer ? { timer, completedAfterTimer } : null;
    }, timeoutMs, 'timer checkpoint followed by completed workflow task');
    schedule.push('durable-objective-under-A');

    const crashWait = waitForExit(workerA, timeoutMs);
    const crashRequested = workerA.child.kill('SIGKILL');
    const crashExit = await crashWait;
    schedule.push('execution-boundary-stopped');

    workerB = spawnWorker('worker-B', 'B', workerEnv);
    const readyB = await waitForEvent(workerB, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready B');
    schedule.push('semantic-dimension-mutated:workflowImplementationSha256');
    schedule.push('recovery-under-B-attempted');

    const nondeterminism = await waitForHistory(handle, (history) => {
      const failed = (history.events ?? []).findLast((event) => {
        const attrs = event.workflowTaskFailedEventAttributes;
        return attrs?.failure?.message && /nondeterminism/i.test(attrs.failure.message);
      });
      return failed ?? null;
    }, timeoutMs, 'WorkflowTaskFailed with Nondeterminism');
    schedule.push('incompatible-recovery-rejected');

    await closeWorker(workerB);

    workerC = spawnWorker('worker-C', 'A', workerEnv);
    await waitForEvent(workerC, (event) => event.event === 'worker_ready', timeoutMs, 'worker_ready C');
    await handle.signal('naia-t16-release');
    const result = await handle.result();
    const description = await handle.describe();
    schedule.push('compatible-profile-recovery-observed');
    schedule.push('final-state-inspected');

    const rejectedExplicitly = Boolean(nondeterminism.value?.workflowTaskFailedEventAttributes?.failure?.message?.match(/nondeterminism/i));
    const priorMeaningPreserved =
      result?.origin === 'compatible-profile' &&
      result?.semanticProfile === 'temporal-t16-profile-A';

    return {
      objectiveIdentity: objectiveId,
      semanticMutation: { dimension: 'workflowImplementationSha256', before: beforeSha, after: afterSha },
      durableCheckpointBeforeMutation: Boolean(checkpoint.value),
      recoveryAttemptedUnderMutatedProfile: readyB.semanticProfile === 'temporal-t16-profile-B',
      compatibilityDisposition: {
        kind: rejectedExplicitly ? 'REJECTED_INCOMPATIBLE' : 'UNKNOWN',
        explicit: rejectedExplicitly,
        migrationIdentity: null
      },
      silentSemanticChangeObserved: result?.semanticProfile === 'temporal-t16-profile-B',
      priorMeaningPreservedOrExplicitlyMigrated: rejectedExplicitly && priorMeaningPreserved,
      durableAuthorityAlive: Boolean(description),
      deterministicScheduleObserved: JSON.stringify(schedule) === JSON.stringify([
        'durable-objective-under-A',
        'execution-boundary-stopped',
        'semantic-dimension-mutated:workflowImplementationSha256',
        'recovery-under-B-attempted',
        'incompatible-recovery-rejected',
        'compatible-profile-recovery-observed',
        'final-state-inspected'
      ]),
      rawNativeEvidence: {
        objectiveId,
        workflowId: handle.workflowId,
        taskQueue,
        beforeWorkflowSha256: beforeSha,
        afterWorkflowSha256: afterSha,
        schedule,
        checkpointEventId: String(checkpoint.value.timer.eventId ?? ''),
        nondeterminismEventId: String(nondeterminism.value.eventId ?? ''),
        nondeterminismFailure: nondeterminism.value.workflowTaskFailedEventAttributes?.failure ?? null,
        result,
        workflowDescription: description,
        crash: { requested: crashRequested, exit: crashExit },
        workerA: { pid: workerA.pid, events: workerA.events, stderr: workerA.stderr, exit: workerA.exit },
        workerB: { pid: workerB.pid, events: workerB.events, stderr: workerB.stderr, exit: workerB.exit },
        workerC: { pid: workerC.pid, events: workerC.events, stderr: workerC.stderr, exit: workerC.exit }
      }
    };
  } finally {
    await Promise.all([closeWorker(workerA), closeWorker(workerB), closeWorker(workerC)]);
    await connection.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const output = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const evidence = await runTemporalT16();
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'TEMPORAL_T16_EVIDENCE_EMITTED', output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
