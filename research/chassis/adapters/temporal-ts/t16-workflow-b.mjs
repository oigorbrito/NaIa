import { condition, defineSignal, setHandler } from '@temporalio/workflow';

const releaseSignal = defineSignal('naia-t16-release');

export async function t16VersionedWorkflow(input) {
  let released = false;
  setHandler(releaseSignal, () => { released = true; });

  // Deliberately omits profile A's durable timer command. Replaying A history
  // under this implementation must be rejected as nondeterministic.
  await condition(() => released);

  return {
    objectiveId: input.objectiveId,
    origin: 'incompatible-profile',
    semanticProfile: 'temporal-t16-profile-B'
  };
}
