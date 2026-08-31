import readline from 'node:readline';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { configureT5WorkerRuntime, releaseT5Gate, resetT5Gate, t5OwnershipWorkflow } from './t5-workflow.mjs';

const workerId = process.env.NAIA_T5_WORKER_ID;
const executorId = process.env.NAIA_T5_EXECUTOR_ID;
const listenQueue = process.env.NAIA_T5_LISTEN_QUEUE;
const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
const appName = 'naia-chassis-t5-v1';
const appVersion = 'naia-chassis-t5-v1';

if (!workerId || !executorId || !listenQueue || !systemDatabaseUrl) {
  throw new Error('NAIA_T5_WORKER_ID, NAIA_T5_EXECUTOR_ID, NAIA_T5_LISTEN_QUEUE and DBOS_SYSTEM_DATABASE_URL are required');
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, workerId, executorId, pid: process.pid, timestamp: new Date().toISOString(), ...fields })}\n`);
}

const logger = {
  info(message, metadata) { emit('dbos_log', { level: 'info', message: String(message), metadata: metadata ?? null }); },
  debug(message, metadata) { emit('dbos_log', { level: 'debug', message: String(message), metadata: metadata ?? null }); },
  warn(message, metadata) {
    const text = String(message);
    emit('dbos_log', { level: 'warn', message: text, metadata: metadata ?? null });
    if (text.includes('outcome was not recorded: the workflow is no longer owned by this execution')) {
      emit('stale_outcome_rejected', { message: text });
    }
  },
  error(message, metadata) { emit('dbos_log', { level: 'error', message: String(message), metadata: metadata ?? null }); }
};

configureT5WorkerRuntime({ workerId, executorId, emit });

DBOS.setConfig({
  name: appName,
  systemDatabaseUrl,
  executorID: executorId,
  applicationVersion: appVersion,
  runAdminServer: false,
  logger,
  listenQueues: [listenQueue]
});

await DBOS.launch();
await DBOS.registerQueue('naia-t5-queue-A', { onConflict: 'always_update', workerConcurrency: 1 });
await DBOS.registerQueue('naia-t5-queue-B', { onConflict: 'always_update', workerConcurrency: 1 });
emit('worker_ready', { listenQueue });

const activeHandles = new Map();

function trackHandle(objectiveId, handle) {
  activeHandles.set(objectiveId, handle);
  handle.getResult().then(
    (result) => emit('workflow_handle_result', { objectiveId, result }),
    (error) => emit('workflow_handle_error', { objectiveId, error: String(error) })
  );
}

async function handleCommand(command) {
  const objectiveId = command.objectiveId;
  switch (command.command) {
    case 'start': {
      resetT5Gate();
      const handle = await DBOS.startWorkflow(t5OwnershipWorkflow, {
        workflowID: objectiveId,
        queueName: command.queueName
      })({ objectiveId });
      trackHandle(objectiveId, handle);
      emit('workflow_started', { objectiveId, workflowId: handle.workflowID, queueName: command.queueName });
      return;
    }
    case 'resume': {
      resetT5Gate();
      const handle = await DBOS.resumeWorkflow(objectiveId, { queueName: command.queueName });
      trackHandle(objectiveId, handle);
      emit('workflow_resumed', { objectiveId, workflowId: handle.workflowID, queueName: command.queueName });
      return;
    }
    case 'release':
      releaseT5Gate();
      emit('release_ack', { objectiveId });
      return;
    case 'status': {
      const status = await DBOS.getWorkflowStatus(objectiveId);
      emit('workflow_status', { objectiveId, status: status ?? null });
      return;
    }
    case 'exit':
      await DBOS.shutdown();
      process.exit(0);
      return;
    default:
      throw new Error(`unsupported T5 worker command: ${command.command}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch (error) { emit('command_error', { error: String(error), line }); return; }
  handleCommand(command).catch((error) => emit('command_error', { command: command.command, objectiveId: command.objectiveId ?? null, error: String(error) }));
});

process.on('SIGTERM', async () => {
  await DBOS.shutdown().catch(() => {});
  process.exit(0);
});
