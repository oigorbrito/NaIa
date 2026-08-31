import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';

const workerId = process.env.NAIA_T16_WORKER_ID;
const semanticProfile = process.env.NAIA_T16_SEMANTIC_PROFILE;
const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
const taskQueue = process.env.NAIA_TEMPORAL_T16_TASK_QUEUE ?? 'naia-chassis-t16-v1';

if (!workerId || !['A', 'B'].includes(semanticProfile)) {
  throw new Error('NAIA_T16_WORKER_ID and NAIA_T16_SEMANTIC_PROFILE=A|B are required');
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    workerId,
    semanticProfile: `temporal-t16-profile-${semanticProfile}`,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

const workflowsPath = fileURLToPath(new URL(`./t16-workflow-${semanticProfile.toLowerCase()}.mjs`, import.meta.url));
const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  workflowsPath,
  identity: `naia-t16-${workerId}:${process.pid}`,
  maxCachedWorkflows: 0,
  shutdownGraceTime: '5 seconds',
  shutdownForceTime: '10 seconds'
});

const runPromise = worker.run();
emit('worker_ready', { address, namespace, taskQueue, workflowsPath });

async function close() {
  worker.shutdown();
  await runPromise.catch(() => {});
  await connection.close();
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch (error) { emit('command_error', { error: String(error), line }); return; }
  if (command.command === 'exit') {
    close().then(() => process.exit(0), (error) => {
      emit('command_error', { command: 'exit', error: String(error) });
      process.exit(1);
    });
  } else {
    emit('command_error', { command: command.command ?? null, error: 'unsupported T16 worker command' });
  }
});

process.on('SIGTERM', () => {
  close().finally(() => process.exit(0));
});
