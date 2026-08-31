import { condition, defineSignal, setHandler, sleep } from '@temporalio/workflow';

const releaseSignal = defineSignal('naia-t16-release');

export async function t16VersionedWorkflow(input) {
  let released = false;
  setHandler(releaseSignal, () => { released = true; });

  await sleep('1 millisecond');
  await condition(() => released);

  return {
    objectiveId: input.objectiveId,
    origin: 'compatible-profile',
    semanticProfile: 'temporal-t16-profile-A'
  };
}
