export async function t11ProtectedOperation({ oracleUrl, objectiveId, operationId }) {
  const response = await fetch(`${oracleUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId
    },
    body: JSON.stringify({ objectiveId, operationId, source: 'temporal-t11-protected-operation' })
  });
  if (!response.ok) throw new Error(`T11 oracle responded ${response.status}`);
  return await response.json();
}
