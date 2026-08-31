import { logger, task } from '@trigger.dev/sdk';

export const naiaChassisObjective = task({
  id: 'naia-chassis-objective',
  retry: {
    maxAttempts: 3,
    factor: 1,
    minTimeoutInMs: 500,
    maxTimeoutInMs: 500,
    randomize: false
  },
  run: async (payload, { ctx }) => {
    const { oracleUrl, objectiveId, operationId, injectResponseLoss } = payload;
    if (!objectiveId) throw new Error('objectiveId is required');
    if (!operationId) throw new Error('operationId is required');
    if (!oracleUrl) throw new Error('oracleUrl is required');

    logger.info('external_request_starting', {
      objectiveId,
      operationId,
      attempt: ctx.attempt.number,
      injectResponseLoss: Boolean(injectResponseLoss)
    });

    try {
      const response = await fetch(`${oracleUrl}/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-operation-id': operationId,
          ...(injectResponseLoss ? { 'x-drop-response-after-apply-once': '1' } : {})
        },
        body: JSON.stringify({
          objectiveId,
          operationId,
          attempt: ctx.attempt.number,
          runId: ctx.run.id
        })
      });

      if (!response.ok) throw new Error(`oracle responded ${response.status}`);
      const externalState = await response.json();
      logger.info('external_effect_observed_before_checkpoint', {
        objectiveId,
        operationId,
        attempt: ctx.attempt.number,
        externalState
      });
      logger.info('external_request_confirmed', {
        objectiveId,
        operationId,
        attempt: ctx.attempt.number,
        externalState
      });
      return { externalState, finalAttempt: ctx.attempt.number };
    } catch (error) {
      logger.error('external_request_applied_or_ambiguous', {
        objectiveId,
        operationId,
        attempt: ctx.attempt.number,
        error: String(error)
      });
      throw error;
    }
  }
});
