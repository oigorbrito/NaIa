const CRITICAL_MUTANTS = new Set(['T5', 'T7', 'T8', 'T11', 'T12', 'T16']);

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value !== process.pid;
}

export function normalizeWorkerProcessPids(...values) {
  return [...new Set(values.flat(Infinity).filter(validPid))];
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
  return normalizeWorkerProcessPids(run?.rawObservations?.workerProcessPids ?? []);
}

export function workerPidProvenanceRequired({ setupStatus, mutantId, run }) {
  return setupStatus === 'READY'
    && CRITICAL_MUTANTS.has(mutantId)
    && run?.fault?.injected === true;
}

export function validateWorkerPidCleanupEvidence({ setupStatus, mutantId, run, cleanup }) {
  const required = workerPidProvenanceRequired({ setupStatus, mutantId, run });
  const workerProcessPids = explicitWorkerProcessPids(run);
  const observedWorkerPids = normalizeWorkerProcessPids(cleanup?.observedWorkerPids ?? []);
  const liveObservedWorkerPids = normalizeWorkerProcessPids(cleanup?.liveObservedWorkerPids ?? []);
  const errors = [];

  if (required && workerProcessPids.length === 0) {
    errors.push('injected critical execution lacks explicit worker process PID provenance');
  }
  if (required) {
    const missingFromCleanup = workerProcessPids.filter((pid) => !observedWorkerPids.includes(pid));
    if (missingFromCleanup.length > 0) {
      errors.push(`cleanup evidence omitted explicit worker process PIDs: ${missingFromCleanup.join(',')}`);
    }
    const liveWorkers = workerProcessPids.filter((pid) => liveObservedWorkerPids.includes(pid));
    if (liveWorkers.length > 0) {
      errors.push(`cleanup evidence reports worker process PIDs still alive: ${liveWorkers.join(',')}`);
    }
  }

  return {
    valid: errors.length === 0,
    required,
    workerProcessPids,
    observedWorkerPids,
    liveObservedWorkerPids,
    errors
  };
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
