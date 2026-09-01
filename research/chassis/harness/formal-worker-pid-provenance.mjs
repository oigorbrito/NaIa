const CRITICAL_MUTANTS = new Set(['T5', 'T7', 'T8', 'T11', 'T12', 'T16']);

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value !== process.pid;
}

export function collectObservedPids(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (validPid(value.pid)) output.add(value.pid);
  if (Array.isArray(value)) {
    for (const item of value) collectObservedPids(item, output);
    return output;
  }
  for (const nested of Object.values(value)) collectObservedPids(nested, output);
  return output;
}

export function explicitWorkerProcessPids(run) {
  const values = run?.rawObservations?.workerProcessPids;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(validPid))];
}

export function workerPidProvenanceRequired({ setupStatus, mutantId, run }) {
  return setupStatus === 'READY'
    && CRITICAL_MUTANTS.has(mutantId)
    && run?.fault?.injected === true;
}

export function assessWorkerPidCleanup({ setupStatus, mutantId, run, pidAlive }) {
  if (typeof pidAlive !== 'function') throw new Error('pidAlive function is required');

  const workerProcessPids = explicitWorkerProcessPids(run);
  const observed = collectObservedPids(run?.rawObservations ?? {});
  for (const pid of workerProcessPids) observed.add(pid);

  const observedPids = [...observed];
  const liveObservedPids = observedPids.filter((pid) => pidAlive(pid));
  const provenanceRequired = workerPidProvenanceRequired({ setupStatus, mutantId, run });
  const provenanceObserved = !provenanceRequired || workerProcessPids.length > 0;

  return {
    workerProcessPids,
    observedPids,
    liveObservedPids,
    provenanceRequired,
    provenanceObserved,
    workerCleanup: provenanceObserved && liveObservedPids.length === 0
  };
}
