import { proxyActivities } from '@temporalio/workflow';

const { t5AsyncCompletionActivity } = proxyActivities({
  startToCloseTimeout: '2 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '1 second',
    backoffCoefficient: 1
  }
});

export async function t5OwnershipWorkflow(input) {
  return await t5AsyncCompletionActivity(input);
}
