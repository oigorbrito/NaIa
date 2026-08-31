import * as restate from '@restatedev/restate-sdk';

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'restate-ts-v1',
    attempt: Number(fields.attempt ?? 1),
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

export const naiaObjective = restate.workflow({
  name: 'NaIaObjective',
  handlers: {
    run: async (ctx, input) => {
      const { oracleUrl, objectiveId, operationId } = input;
      ctx.set('status', 'RUNNING');

      const externalState = await ctx.run(
        'external-effect',
        async () => {
          const injectResponseLoss = process.env.NAIA_DROP_RESPONSE_AFTER_APPLY === '1';
          emit('external_request_starting', { objectiveId, operationId, injectResponseLoss });

          try {
            const response = await fetch(`${oracleUrl}/apply`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-operation-id': operationId,
                ...(injectResponseLoss ? { 'x-drop-response-after-apply': '1' } : {})
              },
              body: JSON.stringify({ objectiveId, operationId })
            });

            if (!response.ok) throw new Error(`oracle responded ${response.status}`);
            const state = await response.json();
            emit('external_request_confirmed', { objectiveId, operationId, externalState: state });
            return state;
          } catch (error) {
            emit('external_request_applied_or_ambiguous', {
              objectiveId,
              operationId,
              error: String(error)
            });
            throw error;
          }
        },
        {
          maxRetryAttempts: 3,
          initialRetryInterval: 100
        }
      );

      ctx.set('status', 'COMPLETED');
      ctx.set('externalState', externalState);
      return externalState;
    },
    status: async (ctx) => ({
      state: (await ctx.get('status')) ?? 'UNKNOWN',
      externalState: (await ctx.get('externalState')) ?? null
    })
  }
});
