import { defineQuery, proxyActivities, setHandler, sleep } from '@temporalio/workflow';

export const t11StatusQuery = defineQuery('naia-t11-status');

const { t11ProtectedOperation } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 1 }
});

export async function t11CancellationWorkflow(input) {
  let phase = 'STARTING';
  setHandler(t11StatusQuery, () => ({
    objectiveId: input.objectiveId,
    operationId: input.operationId,
    phase
  }));

  phase = 'WAITING_CANCEL';
  await sleep('365 days');

  phase = 'POST_CANCEL_PROTECTED_OPERATION';
  const protectedResult = await t11ProtectedOperation(input);
  phase = 'COMPLETED';
  return { origin: 'protected-operation', protectedResult };
}
