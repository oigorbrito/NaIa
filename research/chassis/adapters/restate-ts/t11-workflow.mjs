// LOCAL TEST HARNESS: controlled fault-injection for NaIa's own chassis qualification.
// No third-party target, credential bypass, or real-world service disruption.
import * as restate from '@restatedev/restate-sdk';

const variant = process.env.NAIA_T11_RESTATE_VARIANT ?? 'A';
if (!['A', 'B'].includes(variant)) throw new Error('NAIA_T11_RESTATE_VARIANT must be A or B');

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    variant,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    ...fields
  })}\n`);
}

function serializeError(error) {
  return {
    name: error?.name ?? null,
    message: error?.message ?? String(error),
    code: error?.code ?? error?.errorCode ?? null
  };
}

export const t11Workflow = restate.workflow({
  name: 'NaIaT11',
  handlers: {
    run: async (ctx, input) => {
      const checkpoint = await ctx.run('pre-cancel-checkpoint', async () => ({
        objectiveId: input.objectiveId,
        operationId: input.operationId,
        canonicalMeaning: 'naia-t11-cancel-crash-retry'
      }));

      const cancellationPoint = ctx.sleep({ minutes: 5 });
      emit('t11_pre_cancel_checkpoint', {
        objectiveId: input.objectiveId,
        operationId: input.operationId,
        checkpoint
      });

      try {
        await cancellationPoint;
      } catch (error) {
        if (error instanceof restate.CancelledError) {
          emit('t11_native_cancellation_observed', {
            objectiveId: input.objectiveId,
            operationId: input.operationId,
            error: serializeError(error)
          });
        }
        throw error;
      }

      emit('t11_post_cancel_boundary_reached', {
        objectiveId: input.objectiveId,
        operationId: input.operationId
      });

      const protectedResult = await ctx.run('post-cancel-protected-operation', async () => {
        emit('t11_protected_operation_attempt', {
          objectiveId: input.objectiveId,
          operationId: input.operationId
        });
        const response = await fetch(`${input.oracleUrl}/apply`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-operation-id': input.operationId
          },
          body: JSON.stringify({
            objectiveId: input.objectiveId,
            operationId: input.operationId,
            variant
          })
        });
        if (!response.ok) throw new Error(`T11 protected oracle rejected with ${response.status}`);
        return response.json();
      });

      emit('t11_protected_operation_accepted', {
        objectiveId: input.objectiveId,
        operationId: input.operationId,
        protectedResult
      });

      return {
        objectiveId: input.objectiveId,
        operationId: input.operationId,
        completedByVariant: variant,
        protectedResult
      };
    }
  }
});
