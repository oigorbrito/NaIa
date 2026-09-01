import * as restate from '@restatedev/restate-sdk';
import { currentT5RequestContext, waitForT5CompletionRelease } from './t5-control.mjs';

const variant = process.env.NAIA_T5_RESTATE_VARIANT ?? 'A';
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T5_RESTATE_VARIANT must be A or B');

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    variant,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

export const t5Workflow = restate.workflow({
  name: 'NaIaT5',
  handlers: {
    run: async (ctx, input) => {
      const checkpoint = await ctx.run('ownership-checkpoint', async () => ({
        objectiveId: input.objectiveId,
        canonicalMeaning: 'naia-t5-live-ownership'
      }));
      const request = currentT5RequestContext();
      emit('t5_authority_acquired_and_held', {
        objectiveId: input.objectiveId,
        requestId: request?.requestId ?? null,
        requestUrl: request?.url ?? null,
        checkpoint
      });

      await waitForT5CompletionRelease();
      emit('t5_completion_attempt', {
        objectiveId: input.objectiveId,
        requestId: request?.requestId ?? null,
        requestUrl: request?.url ?? null
      });

      return {
        objectiveId: input.objectiveId,
        canonicalMeaning: 'naia-t5-live-ownership',
        completedByVariant: variant,
        workerPid: process.pid
      };
    }
  }
});
