import { DBOS } from '@dbos-inc/dbos-sdk';
import { naiaObjective } from './workflows.mjs';

const command = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const objectiveId = args.get('--objective-id');
const operationId = args.get('--operation-id');
const oracleUrl = args.get('--oracle-url');
const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'dbos-ts-v4.27',
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
  if (!systemDatabaseUrl) throw new Error('DBOS_SYSTEM_DATABASE_URL is required');
}

async function launch() {
  DBOS.setConfig({
    name: 'naia-chassis-gate-v1',
    systemDatabaseUrl,
    executorID: 'naia-chassis-local-executor',
    applicationVersion: 'naia-chassis-gate-v1',
    runAdminServer: false
  });
  await DBOS.launch();
  emit('adapter_ready', { executorID: 'naia-chassis-local-executor' });
}

async function start() {
  requireIdentity({ external: true });
  await launch();
  const handle = await DBOS.startWorkflow(naiaObjective, { workflowID: objectiveId })({
    objectiveId,
    operationId,
    oracleUrl
  });
  emit('objective_persisted', { workflowId: handle.workflowID });
  try {
    const result = await handle.getResult();
    emit('objective_completed', { result });
  } finally {
    await DBOS.shutdown();
  }
}

async function resume() {
  requireIdentity({ external: true });
  // DBOS.launch() runs local pending-workflow recovery for this stable executor ID.
  await launch();
  const handle = DBOS.retrieveWorkflow(objectiveId);
  emit('objective_persisted', { workflowId: objectiveId, recovered: true });
  try {
    const result = await handle.getResult();
    emit('objective_completed', { result });
  } finally {
    await DBOS.shutdown();
  }
}

async function status() {
  requireIdentity();
  await launch();
  try {
    const native = await DBOS.getWorkflowStatus(objectiveId);
    const nativeState = native?.status ?? 'UNKNOWN';
    const state = nativeState === 'SUCCESS' ? 'COMPLETED' : nativeState;
    console.log(JSON.stringify({
      objectiveId,
      state,
      currentAuthority: native?.executorId ?? 'unknown',
      operationId: operationId ?? null,
      native
    }));
  } finally {
    await DBOS.shutdown();
  }
}

async function main() {
  switch (command) {
    case 'start':
      await start();
      return;
    case 'resume':
      await resume();
      return;
    case 'status':
      await status();
      return;
    default:
      throw new Error(`unsupported command in T7/T8/T15 slice: ${command}`);
  }
}

main().catch(async (error) => {
  emit('fatal_error', { error: String(error) });
  if (DBOS.isInitialized()) {
    await DBOS.shutdown().catch(() => {});
  }
  process.exitCode = 1;
});
