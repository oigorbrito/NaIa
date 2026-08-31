import { DBOS } from '@dbos-inc/dbos-sdk';
import { holdAfterExternalEffectIfRequested } from '../../harness/fault-barrier.mjs';

function emit(event, fields = {}) {
  const attempt = DBOS.stepStatus?.currentAttempt ?? 0;
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'dbos-ts-v4.27',
    attempt,
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

async function performExternalEffectInternal(input) {
  const attempt = DBOS.stepStatus?.currentAttempt ?? 0;
  const { oracleUrl, objectiveId, operationId } = input;
  const injectResponseLoss = process.env.NAIA_DROP_RESPONSE_AFTER_APPLY === '1';

  emit('external_request_starting', { objectiveId, operationId, injectResponseLoss });

  try {
    const response = await fetch(`${oracleUrl}/apply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operation-id': operationId,
        ...(injectResponseLoss ? { 'x-drop-response-after-apply-once': '1' } : {})
      },
      body: JSON.stringify({ objectiveId, operationId, attempt })
    });

    if (!response.ok) throw new Error(`oracle responded ${response.status}`);
    const externalState = await response.json();
    emit('external_effect_observed_before_checkpoint', { objectiveId, operationId, externalState });
    await holdAfterExternalEffectIfRequested();
    emit('external_request_confirmed', { objectiveId, operationId, externalState });
    return externalState;
  } catch (error) {
    emit('external_request_applied_or_ambiguous', {
      objectiveId,
      operationId,
      error: String(error)
    });
    throw error;
  }
}

export const performExternalEffect = DBOS.registerStep(performExternalEffectInternal, {
  name: 'performExternalEffect',
  retriesAllowed: true,
  maxAttempts: 3,
  intervalSeconds: 1
});

async function naiaObjectiveInternal(input) {
  return performExternalEffect(input);
}

export const naiaObjective = DBOS.registerWorkflow(naiaObjectiveInternal, {
  name: 'naiaObjective'
});
