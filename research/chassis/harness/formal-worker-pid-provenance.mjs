const CRITICAL_MUTANTS = new Set(['T5', 'T7', 'T8', 'T11', 'T12', 'T16']);

export function collectObservedPids(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (Number.isInteger(value.pid) && value.pid > 0 && value.pid !== process.pid) output.add(value.pid);
  if (Array.isArray(value)) {
    for (const item of value) collectObservedPids(item, output);
    return output;
  }
  for (const nested of Object.values(value)) collectObservedPids(nested, output);
  return output;
}

export function workerPidProvenanceRequired({ setupStatus, mutantId, run }) {
  return setupStatus === 'READY'
    && CRITICAL_MUTANTS.has(mutantId)
    && run?.fault?.injected === true;
}

export function assessWorkerPidCleanup({ setupStatus, mutantId, run, pidAlive }) {
  if (typeof pidAlive !== 'function') throw new Error('pidAlive function is required');
  const observedPids = [...collectObservedPids(run?.rawObservations ?? {})];
  const liveObservedPids = observedPids.filter((pid) => pidAlive(pid));
  const provenanceRequired = workerPidProvenanceRequired({ setupStatus, mutantId, run });
  const provenanceObserved = !provenanceRequired || observedPids.length > 0;

  return {
    observedPids,
    liveObservedPids,
    provenanceRequired,
    provenanceObserved,
    workerCleanup: provenanceObserved && liveObservedPids.length === 0
  };
}
