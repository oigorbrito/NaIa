import { DBOS } from '@dbos-inc/dbos-sdk';

let workerRuntime = null;
let gateResolve = null;
let gatePromise = null;

export function configureT5WorkerRuntime(runtime) {
  workerRuntime = runtime;
}

export function resetT5Gate() {
  gatePromise = new Promise((resolve) => { gateResolve = resolve; });
}

export function releaseT5Gate() {
  if (gateResolve) gateResolve();
}

resetT5Gate();

async function t5OwnershipWorkflowInternal(input) {
  if (!workerRuntime) throw new Error('DBOS T5 worker runtime not configured');
  workerRuntime.emit('workflow_body_started', {
    objectiveId: input.objectiveId,
    workerId: workerRuntime.workerId,
    executorId: workerRuntime.executorId
  });
  await gatePromise;
  workerRuntime.emit('workflow_body_released', {
    objectiveId: input.objectiveId,
    workerId: workerRuntime.workerId,
    executorId: workerRuntime.executorId
  });
  return {
    objectiveId: input.objectiveId,
    origin: workerRuntime.workerId === 'worker-A' ? 'old-authority' : 'new-authority',
    workerId: workerRuntime.workerId,
    executorId: workerRuntime.executorId
  };
}

export const t5OwnershipWorkflow = DBOS.registerWorkflow(t5OwnershipWorkflowInternal, {
  name: 'naiaT5OwnershipWorkflow'
});
