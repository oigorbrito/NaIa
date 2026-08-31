import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

const { t5AsyncCompletionActivity } = proxyActivities({
  startToCloseTimeout: '2 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '1 second',
    backoffCoefficient: 1
  }
});

export const t5ReleaseFinalSignal = defineSignal('t5ReleaseFinal');
export const t5StatusQuery = defineQuery('t5Status');

export async function t5OwnershipWorkflow(input) {
  let phase = 'ACTIVITY_PENDING';
  let releaseFinal = false;
  setHandler(t5ReleaseFinalSignal, () => { releaseFinal = true; });
  setHandler(t5StatusQuery, () => ({ phase, releaseFinal }));

  const result = await t5AsyncCompletionActivity(input);
  phase = 'WAITING_FINAL_RELEASE';
  await condition(() => releaseFinal);
  phase = 'COMPLETED';
  return result;
}
