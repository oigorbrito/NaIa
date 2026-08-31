import { DBOS } from '@dbos-inc/dbos-sdk';

let runtime = null;
let releaseResolve;
let releasePromise = new Promise((resolve) => { releaseResolve = resolve; });

export function configureT16Runtime(value) {
  runtime = value;
}

export function resetT16Gate() {
  releasePromise = new Promise((resolve) => { releaseResolve = resolve; });
}

export function releaseT16Gate() {
  releaseResolve?.();
}

async function t16VersionedRecoveryWorkflowInternal(input) {
  if (!runtime) throw new Error('T16 runtime not configured');
  const checkpoint = await DBOS.runStep(async () => ({
    objectiveId: input.objectiveId,
    semanticProfile: runtime.applicationVersion,
    marker: 't16-durable-checkpoint'
  }), { name: 't16DurableCheckpoint' });

  runtime.emit('durable_checkpoint_observed', {
    objectiveId: input.objectiveId,
    applicationVersion: runtime.applicationVersion,
    checkpoint
  });

  await releasePromise;
  runtime.emit('post_checkpoint_released', {
    objectiveId: input.objectiveId,
    applicationVersion: runtime.applicationVersion
  });

  return {
    objectiveId: input.objectiveId,
    origin: 'compatible-profile',
    applicationVersion: runtime.applicationVersion,
    checkpoint
  };
}

export const t16VersionedRecoveryWorkflow = DBOS.registerWorkflow(t16VersionedRecoveryWorkflowInternal, {
  name: 'naiaT16VersionedRecoveryWorkflow'
});
