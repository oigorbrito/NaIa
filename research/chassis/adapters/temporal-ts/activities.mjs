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

  emit('external_request_starting', { objectiveId, operationId });

  try {
    const response = await fetch(`${oracleUrl}/apply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operation-id': operationId,
        ...(attempt === 1 ? { 'x-drop-response-after-apply': '1' } : {})
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
