import { fileURLToPath } from 'node:url';
import { Connection, Client } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { naiaObjective, statusQuery } from './workflows.mjs';

const command = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const objectiveId = args.get('--objective-id');
const operationId = args.get('--operation-id');
const oracleUrl = args.get('--oracle-url');
const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
const taskQueue = process.env.NAIA_TEMPORAL_TASK_QUEUE ?? 'naia-chassis-gate-v1';

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'temporal-ts-restricted-v1',
    objectiveId,
    attempt: Number(fields.attempt ?? 1),
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

function requireIdentity({ external = false } = {}) {
  if (!objectiveId) throw new Error('--objective-id is required');
  if (external && !operationId) throw new Error('--operation-id is required');
  if (external && !oracleUrl) throw new Error('--oracle-url is required');
}

async function withClient(fn) {
  const connection = await Connection.connect({ address });
  try {
    const client = new Client({ connection, namespace });
    return await fn(client);
  } finally {
    await connection.close();
  }
}

async function runWorker({ startWorkflow }) {
  requireIdentity({ external: true });
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: fileURLToPath(new URL('./workflows.mjs', import.meta.url)),
    activities: await import('./activities.mjs'),
    shutdownGraceTime: '5 seconds',
    shutdownForceTime: '10 seconds'
  });

  emit('adapter_ready', { address, namespace, taskQueue });
  const runPromise = worker.run();

  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection, namespace });
  try {
    let handle;
    if (startWorkflow) {
      handle = await client.workflow.start(naiaObjective, {
        workflowId: objectiveId,
        taskQueue,
        args: [{ objectiveId, operationId, oracleUrl }]
      });
      emit('objective_persisted', { workflowId: handle.workflowId });
    } else {
      handle = client.workflow.getHandle(objectiveId);
      emit('objective_persisted', { workflowId: objectiveId, recovered: true });
    }

    handle.result().then(
      (result) => emit('objective_completed', { result }),
      (error) => emit('fatal_error', { error: String(error) })
    );

    await runPromise;
  } finally {
    await clientConnection.close();
    await connection.close();
  }
}

async function main() {
  switch (command) {
    case 'start':
      await runWorker({ startWorkflow: true });
      return;
    case 'resume':
      await runWorker({ startWorkflow: false });
      return;
    case 'status':
      requireIdentity();
      console.log(JSON.stringify(await withClient(async (client) => {
        const handle = client.workflow.getHandle(objectiveId);
        const description = await handle.describe();
        const nativeStatus = description.status?.name ?? String(description.status ?? 'UNKNOWN');
        if (nativeStatus === 'RUNNING') {
          return handle.query(statusQuery);
        }
        return {
          objectiveId,
          state: nativeStatus === 'COMPLETED' ? 'COMPLETED' : nativeStatus,
          nativeStatus
        };
      })));
      return;
    case 'cancel':
      requireIdentity();
      await withClient(async (client) => client.workflow.getHandle(objectiveId).cancel());
      emit('objective_cancelled');
      return;
    default:
      throw new Error(`unsupported command: ${command}`);
  }
}

main().catch((error) => {
  emit('fatal_error', { error: String(error) });
  process.exitCode = 1;
});
