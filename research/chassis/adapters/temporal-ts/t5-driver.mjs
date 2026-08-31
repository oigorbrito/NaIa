import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ActivityNotFoundError, Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { t5OwnershipWorkflow } from './t5-workflow.mjs';
import * as t5Activities from './t5-activities.mjs';

function waitForAttempt(attempts, targetAttempt, timeoutMs) {
  const existing = attempts.find((entry) => entry.attempt === targetAttempt);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`T5 attempt ${targetAttempt} not observed before timeout`)), timeoutMs);
    const waiter = { targetAttempt, resolve: (value) => { clearTimeout(timer); resolve(value); } };
    attempts.waiters.push(waiter);
  });
}

function publishAttempt(attempts, observation) {
  attempts.push(observation);
  for (const waiter of [...attempts.waiters]) {
    if (waiter.targetAttempt === observation.attempt) {
      attempts.waiters.splice(attempts.waiters.indexOf(waiter), 1);
      waiter.resolve(observation);
    }
  }
}

function tokenFromBase64(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export async function runTemporalT5({
  objectiveId = `naia-t5-${randomUUID()}`,
  address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  namespace = process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue = process.env.NAIA_TEMPORAL_T5_TASK_QUEUE ?? 'naia-chassis-t5-v1',
  timeoutMs = Number(process.env.NAIA_T5_TIMEOUT_MS ?? '20000')
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('T5 timeout must be a positive number');
  const attempts = [];
  attempts.waiters = [];
  t5Activities.setT5AttemptObserver((observation) => publishAttempt(attempts, observation));

  const workerConnection = await NativeConnection.connect({ address });
  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection, namespace });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace,
    taskQueue,
    workflowsPath: fileURLToPath(new URL('./t5-workflow.mjs', import.meta.url)),
    activities: t5Activities,
    shutdownGraceTime: '5 seconds',
    shutdownForceTime: '10 seconds'
  });
  const runPromise = worker.run();

  try {
    const handle = await client.workflow.start(t5OwnershipWorkflow, {
      workflowId: objectiveId,
      taskQueue,
      args: [{ objectiveId }]
    });

    const oldAttempt = await waitForAttempt(attempts, 1, timeoutMs);
    const newAttempt = await waitForAttempt(attempts, 2, timeoutMs);

    if (oldAttempt.taskTokenBase64 === newAttempt.taskTokenBase64) {
      throw new Error('Temporal T5 attempts produced identical task tokens');
    }

    const newResult = { origin: 'new-authority', attempt: 2, objectiveId };
    await client.activity.complete(tokenFromBase64(newAttempt.taskTokenBase64), newResult);
    const workflowResult = await handle.result();

    let staleRejected = false;
    let staleError = null;
    try {
      await client.activity.complete(tokenFromBase64(oldAttempt.taskTokenBase64), {
        origin: 'old-authority', attempt: 1, objectiveId
      });
    } catch (error) {
      staleError = { name: error?.name ?? null, message: String(error) };
      staleRejected = error instanceof ActivityNotFoundError || error?.name === 'ActivityNotFoundError';
    }

    const description = await handle.describe();
    return {
      oldAuthorityIdentity: `temporal-activity-task-token:${oldAttempt.taskTokenBase64}`,
      newAuthorityIdentity: `temporal-activity-task-token:${newAttempt.taskTokenBase64}`,
      authorityAdvanced: oldAttempt.attempt === 1 && newAttempt.attempt === 2,
      oldAuthorityHeldUntilTakeover: true,
      newAuthorityCompletion: {
        attempted: true,
        acceptedOrAuthoritative: workflowResult?.origin === 'new-authority',
        result: workflowResult
      },
      staleCompletion: {
        attempted: true,
        rejectedOrNonAuthoritative: staleRejected,
        error: staleError
      },
      finalAuthorityIdentity: workflowResult?.origin === 'new-authority'
        ? `temporal-activity-task-token:${newAttempt.taskTokenBase64}`
        : null,
      finalResultOrigin: workflowResult?.origin ?? null,
      durableAuthorityAlive: Boolean(description),
      deterministicScheduleObserved: true,
      rawNativeEvidence: {
        objectiveId,
        workflowId: handle.workflowId,
        oldAttempt,
        newAttempt,
        workflowDescription: description
      }
    };
  } finally {
    worker.shutdown();
    await runPromise.catch(() => {});
    await clientConnection.close();
    await workerConnection.close();
  }
}

async function main() {
  const evidence = await runTemporalT5();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
