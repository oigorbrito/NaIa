import { createHash } from 'node:crypto';
import { configure, runs, tasks } from '@trigger.dev/sdk';

const command = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const objectiveId = args.get('--objective-id');
const operationId = args.get('--operation-id');
const oracleUrl = args.get('--oracle-url');
const accessToken = process.env.TRIGGER_SECRET_KEY;
const baseURL = process.env.TRIGGER_API_URL;
const previewBranch = process.env.TRIGGER_PREVIEW_BRANCH;

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'triggerdev-v4.5.15',
    objectiveId,
    attempt: Number(fields.attempt ?? 1),
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function objectiveTag() {
  return `naia-objective:${digest(objectiveId).slice(0, 32)}`;
}

function operationTag() {
  return `naia-operation:${digest(operationId).slice(0, 32)}`;
}

function idempotencyKey() {
  return `naia-objective-${digest(objectiveId)}`;
}

function requireIdentity({ external = false } = {}) {
  if (!objectiveId) throw new Error('--objective-id is required');
  if (external && !operationId) throw new Error('--operation-id is required');
  if (external && !oracleUrl) throw new Error('--oracle-url is required');
  if (!accessToken) throw new Error('TRIGGER_SECRET_KEY is required');
}

function configureSdk() {
  // Trigger.dev v4.5.15 keeps `secretKey` for compatibility but marks it deprecated.
  // `accessToken` is the non-deprecated ApiClientConfiguration field; the project
  // secret key remains the credential supplied by TRIGGER_SECRET_KEY.
  configure({
    accessToken,
    ...(baseURL ? { baseURL } : {}),
    ...(previewBranch ? { previewBranch } : {})
  });
  emit('adapter_ready', { baseURL: baseURL ?? 'https://api.trigger.dev' });
}

async function findRuns() {
  const page = await runs.list({
    taskIdentifier: ['naia-chassis-objective'],
    tag: [objectiveTag()],
    limit: 2
  });
  return page.data;
}

async function findUniqueRun() {
  const matches = await findRuns();
  if (matches.length > 1) {
    throw new Error(`multiple Trigger.dev runs found for objective ${objectiveId}`);
  }
  return matches[0] ?? null;
}

async function triggerOrAttach() {
  const existing = await findUniqueRun();
  if (existing) return { id: existing.id, recovered: true };

  const handle = await tasks.trigger(
    'naia-chassis-objective',
    {
      objectiveId,
      operationId,
      oracleUrl,
      injectResponseLoss: process.env.NAIA_DROP_RESPONSE_AFTER_APPLY === '1'
    },
    {
      idempotencyKey: idempotencyKey(),
      idempotencyKeyTTL: '1h',
      tags: [objectiveTag(), operationTag()]
    }
  );
  // Single-trigger RunHandle has id/publicAccessToken/taskIdentifier in v4.5.15.
  // `isCached` belongs to BatchedRunHandle, so recovery is derived only from
  // the explicit existing-run lookup above.
  return { id: handle.id, recovered: false };
}

async function waitForRun(runId) {
  const run = await runs.poll(runId, { pollIntervalMs: 500 });
  if (run.status !== 'COMPLETED') {
    throw new Error(`Trigger.dev run ${runId} ended with status ${run.status}`);
  }
  return run;
}

function contractState(status) {
  switch (status) {
    case 'COMPLETED': return 'COMPLETED';
    case 'CANCELED': return 'CANCELLED';
    case 'PENDING_VERSION':
    case 'PENDING':
    case 'DELAYED':
    case 'QUEUED':
    case 'WAITING_FOR_DEPLOY': return 'PENDING';
    case 'DEQUEUED':
    case 'EXECUTING':
    case 'WAITING':
    case 'WAITING_TO_RESUME':
    case 'RETRYING_AFTER_FAILURE':
    case 'PAUSED': return 'RUNNING';
    case 'FAILED':
    case 'CRASHED':
    case 'INTERRUPTED':
    case 'SYSTEM_FAILURE':
    case 'EXPIRED':
    case 'TIMED_OUT': return 'FAILED';
    default: return 'UNKNOWN';
  }
}

async function startOrResume({ recovered }) {
  requireIdentity({ external: true });
  configureSdk();
  const handle = await triggerOrAttach();
  emit('objective_persisted', { runId: handle.id, recovered: recovered || handle.recovered });
  const run = await waitForRun(handle.id);
  emit('objective_completed', {
    runId: handle.id,
    result: run.output,
    nativeStatus: run.status
  });
}

async function status() {
  requireIdentity();
  configureSdk();
  const run = await findUniqueRun();
  if (!run) throw new Error(`no Trigger.dev run found for objective ${objectiveId}`);
  const full = await runs.retrieve(run.id);
  console.log(JSON.stringify({
    objectiveId,
    state: contractState(full.status),
    attempt: full.attempts?.length ?? null,
    currentAuthority: 'trigger.dev-control-plane',
    operationId: operationId ?? null,
    externalState: full.output?.externalState ?? null,
    evidenceComplete: full.status === 'COMPLETED' && full.output?.externalState?.applyCount === 1,
    native: full
  }));
}

async function cancel() {
  requireIdentity();
  configureSdk();
  const run = await findUniqueRun();
  if (!run) throw new Error(`no Trigger.dev run found for objective ${objectiveId}`);
  await runs.cancel(run.id);
  emit('objective_cancelled', { runId: run.id });
}

async function main() {
  switch (command) {
    case 'start':
      await startOrResume({ recovered: false });
      return;
    case 'resume':
      await startOrResume({ recovered: true });
      return;
    case 'status':
      await status();
      return;
    case 'cancel':
      await cancel();
      return;
    default:
      throw new Error(`unsupported command in T7/T8/T15 slice: ${command}`);
  }
}

main().catch((error) => {
  emit('fatal_error', { error: String(error) });
  process.exitCode = 1;
});
