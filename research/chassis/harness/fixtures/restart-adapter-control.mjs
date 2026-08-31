const mode = process.argv[2];
const attempt = Number(process.argv[3] ?? '1');
const oracleUrl = process.env.NAIA_ORACLE_URL;
const objectiveId = process.env.NAIA_OBJECTIVE_ID ?? 'objective-control';

if (!oracleUrl) throw new Error('NAIA_ORACLE_URL required');
if (!['stable', 'mutant'].includes(mode)) throw new Error('mode must be stable or mutant');

const operationId = mode === 'stable'
  ? `${objectiveId}:external-effect`
  : `${objectiveId}:external-effect:attempt-${attempt}`;

function emit(event, extra = {}) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: `control-${mode}`,
    objectiveId,
    attempt,
    operationId,
    timestamp: new Date().toISOString(),
    ...extra
  }) + '\n');
}

emit('adapter_ready');
emit('objective_persisted');

const dropResponse = attempt === 1;
try {
  const response = await fetch(`${oracleUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId,
      ...(dropResponse ? { 'x-drop-response-after-apply': '1' } : {})
    },
    body: JSON.stringify({ objectiveId, attempt })
  });

  if (!response.ok) {
    throw new Error(`oracle responded ${response.status}`);
  }

  emit('external_request_confirmed');
  emit('objective_completed');
  process.exit(0);
} catch (error) {
  emit('external_request_applied_or_ambiguous', { error: String(error) });
  setInterval(() => {}, 1000);
}
