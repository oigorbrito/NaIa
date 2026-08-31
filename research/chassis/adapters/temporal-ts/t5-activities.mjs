import { CompleteAsyncError, activityInfo } from '@temporalio/activity';

let attemptObserver = null;

export function setT5AttemptObserver(observer) {
  attemptObserver = observer;
}

export async function t5AsyncCompletionActivity(input) {
  const info = activityInfo();
  const observation = {
    objectiveId: input.objectiveId,
    attempt: info.attempt,
    taskTokenBase64: Buffer.from(info.taskToken).toString('base64'),
    activityId: info.activityId,
    workflowExecution: info.workflowExecution,
    timestamp: new Date().toISOString()
  };
  if (typeof attemptObserver !== 'function') {
    throw new Error('T5 attempt observer not configured');
  }
  attemptObserver(observation);
  throw new CompleteAsyncError();
}
