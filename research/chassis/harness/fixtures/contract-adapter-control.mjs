const command = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const objectiveId = args.get('--objective-id');
const requestedOperationId = args.get('--operation-id');
const oracleUrl = args.get('--oracle-url') ?? process.env.NAIA_ORACLE_URL;
const mutant = process.env.NAIA_CONTROL_MUTANT === '1';

if (!objectiveId) throw new Error('--objective-id required');

function emit(event, fields = {}) {
  process.stdout.write(JSON.stringify({ event, candidate: mutant ? 'control-mutant' : 'control-stable', objectiveId, timestamp: new Date().toISOString(), ...fields }) + '\n');
}

if (process.env.NAIA_CONTROL_BLOCKED === '1') {
  emit('fatal_error', { error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'candidate-sdk'" });
  process.exit(1);
}

if (command === 'status') {
  const response = await fetch(`${oracleUrl}/operations`);
  const operations = await response.json();
  const related = operations.filter((entry) => {
    try { return JSON.parse(entry.payload).objectiveId === objectiveId; } catch { return false; }
  });
  console.log(JSON.stringify({ objectiveId, state: related.length > 0 ? 'COMPLETED' : 'FAILED', evidenceComplete: related.reduce((n, e) => n + e.applyCount, 0) === 1 }));
  process.exit(0);
}

if (!requestedOperationId) throw new Error('--operation-id required');
if (!oracleUrl) throw new Error('--oracle-url required');
const operationId = mutant && command === 'resume' ? `${requestedOperationId}:drift` : requestedOperationId;
emit('adapter_ready', { operationId });
emit('objective_persisted', { operationId, recovered: command === 'resume' });

try {
  const response = await fetch(`${oracleUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId,
      ...(process.env.NAIA_DROP_RESPONSE_AFTER_APPLY === '1' ? { 'x-drop-response-after-apply-once': '1' } : {})
    },
    body: JSON.stringify({ objectiveId, operationId, command })
  });
  if (!response.ok) throw new Error(`oracle responded ${response.status}`);
  const result = await response.json();
  emit('external_effect_observed_before_checkpoint', { operationId, result });
  emit('external_request_confirmed', { operationId, result });
  emit('objective_completed', { operationId, result });
} catch (error) {
  emit('external_request_applied_or_ambiguous', { operationId, error: String(error) });
  setInterval(() => {}, 1000);
}
