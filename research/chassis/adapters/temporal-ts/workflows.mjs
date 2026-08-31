import { defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';

const { performExternalEffect } = proxyActivities({
  startToCloseTimeout: '15 seconds',
  retry: {
    maximumAttempts: 3
  }
});

export const statusQuery = defineQuery('naiaStatus');

export async function naiaObjective(input) {
  let status = {
    objectiveId: input.objectiveId,
    state: 'RUNNING',
    attempt: 1,
    currentAuthority: 'temporal-workflow',
    operationId: input.operationId,
    externalState: 'NOT_STARTED',
    evidenceComplete: false
  };

  setHandler(statusQuery, () => status);

  const externalState = await performExternalEffect(input);
  status = {
    ...status,
    state: 'COMPLETED',
    externalState: 'RECONCILED',
    evidenceComplete: true,
    oracleEvidence: externalState
  };
  return status;
}
