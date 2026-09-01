import readline from 'node:readline';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { configureT16Runtime, releaseT16Gate, resetT16Gate, t16VersionedRecoveryWorkflow } from './t16-workflow.mjs';

const workerId = process.env.NAIA_T16_WORKER_ID;
const executorId = process.env.NAIA_T16_EXECUTOR_ID;
const applicationVersion = process.env.NAIA_T16_APPLICATION_VERSION;
const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;

if (!workerId || !executorId || !applicationVersion || !systemDatabaseUrl) {
  throw new Error('NAIA_T16_WORKER_ID, NAIA_T16_EXECUTOR_ID, NAIA_T16_APPLICATION_VERSION and DBOS_SYSTEM_DATABASE_URL are required');
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    workerId,
    executorId,
    applicationVersion,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

configureT16Runtime({ workerId, executorId, applicationVersion, emit });
DBOS.setConfig({
  name: 'naia-chassis-t16-v1',
  systemDatabaseUrl,
  executorID: executorId,
  applicationVersion,
  runAdminServer: false
});

await DBOS.launch();
emit('worker_ready');

async function handleCommand(command) {
  switch (command.command) {
    case 'start': {
      resetT16Gate();
      const handle = await DBOS.startWorkflow(t16VersionedRecoveryWorkflow, { workflowID: command.objectiveId })({ objectiveId: command.objectiveId });
      emit('workflow_started', { objectiveId: command.objectiveId, workflowId: handle.workflowID });
      handle.getResult().then(
        (result) => emit('workflow_result', { objectiveId: command.objectiveId, result }),
        (error) => emit('workflow_error', { objectiveId: command.objectiveId, errorName: error?.name ?? null, error: String(error) })
      );
      return;
    }
    case 'status': {
      const status = await DBOS.getWorkflowStatus(command.objectiveId);
      emit('workflow_status', { objectiveId: command.objectiveId, status: status ?? null });
      return;
    }
    case 'promote-version': {
      if (!command.applicationVersion) throw new Error('promote-version requires applicationVersion');
      await DBOS.setLatestApplicationVersion(command.applicationVersion);
      const latest = await DBOS.getLatestApplicationVersion();
      emit('application_version_promoted', {
        objectiveId: command.objectiveId ?? null,
        promotedVersion: command.applicationVersion,
        latestVersion: latest?.versionName ?? null
      });
      return;
    }
    case 'release':
      releaseT16Gate();
      emit('release_ack', { objectiveId: command.objectiveId });
      return;
    case 'attach': {
      const handle = DBOS.retrieveWorkflow(command.objectiveId);
      emit('recovery_attach_attempted', { objectiveId: command.objectiveId });
      try {
        const result = await handle.getResult();
        emit('recovery_attach_result', { objectiveId: command.objectiveId, result });
      } catch (error) {
        emit('recovery_attach_error', { objectiveId: command.objectiveId, errorName: error?.name ?? null, error: String(error) });
      }
      return;
    }
    case 'exit':
      await DBOS.shutdown();
      process.exit(0);
      return;
    default:
      throw new Error(`unsupported T16 worker command: ${command.command}`);
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
