import { DBOS } from '@dbos-inc/dbos-sdk';

let runtime = null;
let releaseResolve;
let releasePromise = new Promise((resolve) => { releaseResolve = resolve; });

export function configureT11Runtime(value) {
  runtime = value;
}

export function resetT11Gate() {
  releasePromise = new Promise((resolve) => { releaseResolve = resolve; });
}

export function releaseT11Gate() {
  releaseResolve?.();
}

async function protectedOperation(input) {
  if (!runtime) throw new Error('T11 runtime not configured');
  runtime.emit('protected_operation_callback_entered', { objectiveId: input.objectiveId, operationId: input.operationId });
  const response = await fetch(`${input.oracleUrl}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operation-id': input.operationId },
    body: JSON.stringify({ objectiveId: input.objectiveId, operationId: input.operationId, phase: 'post-cancel-protected-operation' })
  });
  if (!response.ok) throw new Error(`T11 oracle responded ${response.status}`);
  return response.json();
}

async function t11CancelCrashRetryWorkflowInternal(input) {
  if (!runtime) throw new Error('T11 runtime not configured');
  runtime.emit('pre_cancel_checkpoint', { objectiveId: input.objectiveId });
  await releasePromise;
  runtime.emit('post_cancel_boundary_challenged', { objectiveId: input.objectiveId });
  const result = await DBOS.runStep(() => protectedOperation(input), { name: 't11ProtectedOperation' });
  return { origin: 'post-cancel-progress', result };
}

export const t11CancelCrashRetryWorkflow = DBOS.registerWorkflow(t11CancelCrashRetryWorkflowInternal, {
  name: 'naiaT11CancelCrashRetryWorkflow'
});
