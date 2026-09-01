import readline from 'node:readline';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { configureT11Runtime, releaseT11Gate, resetT11Gate, t11CancelCrashRetryWorkflow } from './t11-workflow.mjs';

const workerId = process.env.NAIA_T11_WORKER_ID;
const executorId = process.env.NAIA_T11_EXECUTOR_ID;
const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;

if (!workerId || !executorId || !systemDatabaseUrl) {
  throw new Error('NAIA_T11_WORKER_ID, NAIA_T11_EXECUTOR_ID and DBOS_SYSTEM_DATABASE_URL are required');
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, workerId, executorId, pid: process.pid, timestamp: new Date().toISOString(), ...fields })}\n`);
}

configureT11Runtime({ workerId, executorId, emit });
DBOS.setConfig({
  name: 'naia-chassis-t11-v1',
  systemDatabaseUrl,
  executorID: executorId,
  applicationVersion: 'naia-chassis-t11-v1',
  runAdminServer: false
});
await DBOS.launch();
emit('worker_ready');

async function handleCommand(command) {
  switch (command.command) {
    case 'start': {
      resetT11Gate();
      const handle = await DBOS.startWorkflow(t11CancelCrashRetryWorkflow, { workflowID: command.objectiveId })({
        objectiveId: command.objectiveId,
        operationId: command.operationId,
        oracleUrl: command.oracleUrl
      });
      emit('workflow_started', { objectiveId: command.objectiveId, workflowId: handle.workflowID });
      handle.getResult().then(
        (result) => emit('workflow_result', { objectiveId: command.objectiveId, result }),
        (error) => emit('workflow_error', { objectiveId: command.objectiveId, errorName: error?.name ?? null, error: String(error) })
      );
      return;
    }
    case 'attach': {
      const handle = DBOS.retrieveWorkflow(command.objectiveId);
      emit('recovery_attach_attempted', { objectiveId: command.objectiveId });
      try {
        const result = await handle.getResult();
        emit('recovery_attach_result', { objectiveId: command.objectiveId, result });
      } catch (error) {
        const errorText = String(error);
        // DBOS 4.27.6 may revive the durable cancellation as a generic Error while
        // retaining the native cancellation disposition in the message. The T11
        // driver independently requires the durable final workflow state to remain
        // CANCELLED, so this marker is not sufficient by itself for PASS.
        const cancelled =
          error?.name === 'DBOSAwaitedWorkflowCancelledError' ||
          /\bAwaited\s+.+\s+was cancelled\b/i.test(errorText);
        emit(cancelled ? 'recovery_blocked_by_cancellation' : 'recovery_attach_error', {
          objectiveId: command.objectiveId,
          cancelled,
          errorName: error?.name ?? null,
          error: errorText
        });
      }
      return;
    }
    case 'release':
      releaseT11Gate();
      emit('release_ack', { objectiveId: command.objectiveId });
      return;
    case 'status': {
      const status = await DBOS.getWorkflowStatus(command.objectiveId);
      emit('workflow_status', { objectiveId: command.objectiveId, status: status ?? null });
      return;
    }
    case 'exit':
      await DBOS.shutdown();
      process.exit(0);
      return;
    default:
      throw new Error(`unsupported T11 worker command: ${command.command}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch (error) { emit('command_error', { error: String(error), line }); return; }
  handleCommand(command).catch((error) => emit('command_error', {
    command: command.command,
    objectiveId: command.objectiveId ?? null,
    errorName: error?.name ?? null,
    error: String(error)
  }));
});
