import * as restate from '@restatedev/restate-sdk';
import { currentT12RequestContext, waitForT12CompletionRelease } from './t12-control.mjs';

const variant = process.env.NAIA_T12_RESTATE_VARIANT ?? 'A';
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T12_RESTATE_VARIANT must be A or B');

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    variant,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

export const t12Workflow = restate.workflow({
  name: 'NaIaT12',
  handlers: {
    run: async (ctx, input) => {
      const checkpoint = await ctx.run('authority-checkpoint', async () => ({
        objectiveId: input.objectiveId,
        canonicalMeaning: 'naia-t12-stale-completion'
      }));
      const request = currentT12RequestContext();
      emit('t12_authority_acquired_and_held', {
        objectiveId: input.objectiveId,
        requestId: request?.requestId ?? null,
        requestUrl: request?.url ?? null,
        checkpoint
      });

      await waitForT12CompletionRelease();
      emit('t12_completion_attempt', {
        objectiveId: input.objectiveId,
        requestId: request?.requestId ?? null,
        requestUrl: request?.url ?? null
      });

      return {
        objectiveId: input.objectiveId,
        canonicalMeaning: 'naia-t12-stale-completion',
        completedByVariant: variant,
        workerPid: process.pid
      };
    }
  }
});
