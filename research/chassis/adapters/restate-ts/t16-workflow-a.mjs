import * as restate from '@restatedev/restate-sdk';

const CANONICAL_MEANING = 'naia-t16-canonical';

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, variant: 'A', timestamp: new Date().toISOString(), ...fields })}\n`);
}

export const t16WorkflowA = restate.workflow({
  name: 'NaIaT16',
  handlers: {
    run: async (ctx, input) => {
      const checkpoint = await ctx.run('semantic-checkpoint', async () => ({
        objectiveId: input.objectiveId,
        canonicalMeaning: CANONICAL_MEANING
      }));
      emit('t16_checkpoint_observed', { objectiveId: input.objectiveId, checkpoint });
      await ctx.sleep(Number(input.holdMs ?? 3000));
      return {
        objectiveId: input.objectiveId,
        canonicalMeaning: CANONICAL_MEANING,
        completedByVariant: 'A'
      };
    }
  }
});
