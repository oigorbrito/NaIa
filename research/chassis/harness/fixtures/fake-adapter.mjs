const mode = process.argv[2] ?? 'emit-target';

function emit(event) {
  process.stdout.write(JSON.stringify({
    event,
    candidate: 'fake-adapter',
    objectiveId: 'fixture-objective',
    attempt: 1,
    timestamp: new Date().toISOString()
  }) + '\n');
}

emit('adapter_ready');
emit('objective_persisted');
emit('internal_step_completed');

if (mode === 'emit-target') {
  emit('external_request_applied_or_ambiguous');
}

setInterval(() => {}, 1000);
