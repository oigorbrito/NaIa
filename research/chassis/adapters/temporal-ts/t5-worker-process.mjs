import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ActivityNotFoundError, Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as t5Activities from './t5-activities.mjs';

const workerId = process.env.NAIA_T5_WORKER_ID;
const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
const taskQueue = process.env.NAIA_TEMPORAL_T5_TASK_QUEUE ?? 'naia-chassis-t5-v1';
if (!workerId) throw new Error('NAIA_T5_WORKER_ID is required');

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    workerId,
    workerIdentity: `${workerId}:${process.pid}`,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

function tokenFromBase64(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

const attempts = new Map();
t5Activities.setT5AttemptObserver((observation) => {
  attempts.set(observation.attempt, observation);
  emit('activity_attempt_observed', observation);
});

const workerConnection = await NativeConnection.connect({ address });
const clientConnection = await Connection.connect({ address });
const client = new Client({ connection: clientConnection, namespace, identity: `t5-client-${workerId}:${process.pid}` });
const worker = await Worker.create({
  connection: workerConnection,
  namespace,
  taskQueue,
  identity: `${workerId}:${process.pid}`,
  workflowsPath: fileURLToPath(new URL('./t5-workflow.mjs', import.meta.url)),
  activities: t5Activities,
  shutdownGraceTime: '2 seconds',
  shutdownForceTime: '5 seconds'
});
let pollingStopped = false;
const runPromise = worker.run();
emit('worker_ready', { address, namespace, taskQueue });

async function stopPolling() {
  if (!pollingStopped) {
    pollingStopped = true;
    worker.shutdown();
    await runPromise.catch((error) => emit('worker_run_error', { error: String(error) }));
  }
  emit('worker_polling_stopped');
}

async function completeAttempt(command) {
  const attempt = Number(command.attempt);
  const observation = attempts.get(attempt);
  if (!observation) {
    emit('completion_response', { attempt, accepted: false, error: { name: 'AttemptNotObserved', message: `attempt ${attempt} not observed by ${workerId}` } });
    return;
  }
  try {
    await client.activity.complete(tokenFromBase64(observation.taskTokenBase64), {
      origin: command.origin,
      attempt,
      objectiveId: observation.objectiveId,
      workerId,
      workerIdentity: `${workerId}:${process.pid}`
    });
    emit('completion_response', { attempt, accepted: true, origin: command.origin, taskTokenBase64: observation.taskTokenBase64 });
  } catch (error) {
    emit('completion_response', {
      attempt,
      accepted: false,
      origin: command.origin,
      taskTokenBase64: observation.taskTokenBase64,
      staleRejected: error instanceof ActivityNotFoundError || error?.name === 'ActivityNotFoundError',
      error: { name: error?.name ?? null, message: String(error) }
    });
  }
}

async function closeAndExit() {
  await stopPolling();
  await clientConnection.close();
  await workerConnection.close();
  emit('worker_exiting');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch {
    emit('command_error', { error: 'invalid JSON command' });
    return;
  }
  Promise.resolve().then(async () => {
    switch (command.command) {
      case 'stop_polling':
        await stopPolling();
        break;
      case 'complete':
        await completeAttempt(command);
        break;
      case 'exit':
        await closeAndExit();
        break;
      default:
        emit('command_error', { error: `unsupported command ${command.command}` });
    }
  }).catch((error) => emit('command_error', { error: String(error) }));
});
