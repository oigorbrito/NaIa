import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Connection, Client } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { t11CancellationWorkflow } from './t11-workflow.mjs';
import * as activities from './t11-activities.mjs';

const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
const taskQueue = process.env.NAIA_TEMPORAL_T11_TASK_QUEUE ?? 'naia-chassis-t11-v1';
const workerId = process.env.NAIA_T11_WORKER_ID ?? `worker-${process.pid}`;

function emit(event, extra = {}) {
  process.stdout.write(`${JSON.stringify({ event, workerId, pid: process.pid, timestamp: new Date().toISOString(), ...extra })}\n`);
}

const workerConnection = await NativeConnection.connect({ address });
const clientConnection = await Connection.connect({ address });
const client = new Client({ connection: clientConnection, namespace, identity: `naia-t11-client:${workerId}:${process.pid}` });
const worker = await Worker.create({
  connection: workerConnection,
  namespace,
  taskQueue,
  workflowsPath: fileURLToPath(new URL('./t11-workflow.mjs', import.meta.url)),
  activities,
  identity: `naia-t11-worker:${workerId}:${process.pid}`,
  shutdownGraceTime: '2 seconds',
  shutdownForceTime: '5 seconds'
});
const workerRun = worker.run();
emit('worker_ready', { workerIdentity: `naia-t11-worker:${workerId}:${process.pid}`, taskQueue });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  try {
    const command = JSON.parse(line);
    if (command.command === 'start') {
      const handle = await client.workflow.start(t11CancellationWorkflow, {
        workflowId: command.objectiveId,
        taskQueue,
        args: [{ objectiveId: command.objectiveId, operationId: command.operationId, oracleUrl: command.oracleUrl }]
      });
      emit('workflow_started', { objectiveId: command.objectiveId, workflowId: handle.workflowId });
      return;
    }
    if (command.command === 'status') {
      const handle = client.workflow.getHandle(command.objectiveId);
      const description = await handle.describe();
      emit('workflow_status', { objectiveId: command.objectiveId, status: description.status?.name ?? String(description.status ?? 'UNKNOWN'), description });
      return;
    }
    if (command.command === 'exit') {
      rl.close();
      worker.shutdown();
      return;
    }
    emit('command_error', { error: `unsupported command: ${command.command}` });
  } catch (error) {
    emit('command_error', { error: String(error) });
  }
});

await workerRun.catch((error) => emit('worker_error', { error: String(error) }));
await clientConnection.close().catch(() => {});
await workerConnection.close().catch(() => {});
