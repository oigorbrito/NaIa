import { Context } from '@temporalio/activity';

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'temporal-ts-restricted-v1',
    attempt: Context.current().info.attempt,
    timestamp: new Date().toISOString(),
    ...fields
  }) + '\n');
}

export async function performExternalEffect(input) {
  const attempt = Context.current().info.attempt;
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
