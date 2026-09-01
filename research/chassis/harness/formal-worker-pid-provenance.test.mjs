import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessWorkerPidCleanup,
  collectObservedPids,
  explicitWorkerProcessPids,
  normalizeWorkerProcessPids,
  workerPidProvenanceRequired
} from './formal-worker-pid-provenance.mjs';

function run({ injected = true, rawObservations = {} } = {}) {
  return {
    fault: { intended: 'T5', injected },
    rawObservations
  };
}

test('critical READY execution with injected fault requires explicit worker PID provenance', () => {
  assert.equal(workerPidProvenanceRequired({ setupStatus: 'READY', mutantId: 'T5', run: run() }), true);
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T5',
    run: run(),
    pidAlive: () => false
  });
  assert.equal(result.provenanceRequired, true);
  assert.equal(result.provenanceObserved, false);
  assert.equal(result.workerCleanup, false);
  assert.deepEqual(result.workerProcessPids, []);
});

test('driver PID alone does not satisfy explicit worker PID provenance', () => {
  const value = run({ rawObservations: { runnerProcess: { pid: 4099, exitCode: 0 } } });
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T11',
    run: value,
    pidAlive: () => false
  });
  assert.deepEqual(result.observedPids, [4099]);
  assert.deepEqual(result.workerProcessPids, []);
  assert.equal(result.provenanceObserved, false);
  assert.equal(result.workerCleanup, false);
});

test('critical READY execution passes PID cleanup only with explicit worker PIDs and all observed processes dead', () => {
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T11',
    run: run({ rawObservations: {
      workerProcessPids: [4101, 4102],
      runnerProcess: { pid: 4199 },
      workerA: { pid: 4101 },
      workerB: { pid: 4102 }
    } }),
    pidAlive: () => false
  });
  assert.equal(result.provenanceObserved, true);
  assert.equal(result.workerCleanup, true);
  assert.deepEqual(result.workerProcessPids, [4101, 4102]);
  assert.deepEqual(result.observedPids.sort((a, b) => a - b), [4101, 4102, 4199]);
  assert.deepEqual(result.liveObservedPids, []);
});

test('live explicit worker PID keeps worker cleanup closed', () => {
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T12',
    run: run({ rawObservations: { workerProcessPids: [4201], worker: { pid: 4201 } } }),
    pidAlive: (pid) => pid === 4201
  });
  assert.equal(result.provenanceObserved, true);
  assert.equal(result.workerCleanup, false);
  assert.deepEqual(result.liveObservedPids, [4201]);
});

test('uninjected or blocked execution does not invent a cleanup failure solely because no worker PID exists', () => {
  for (const sample of [
    { setupStatus: 'READY', mutantId: 'T7', run: run({ injected: false }) },
    { setupStatus: 'BLOCKED_SETUP', mutantId: 'T7', run: run({ injected: false }) }
  ]) {
    const result = assessWorkerPidCleanup({ ...sample, pidAlive: () => false });
    assert.equal(result.provenanceRequired, false);
    assert.equal(result.provenanceObserved, true);
    assert.equal(result.workerCleanup, true);
  }
});

test('worker PID normalization deduplicates valid process identities', () => {
  assert.deepEqual(normalizeWorkerProcessPids(4301, [4302, 4301], null, -1, '4303'), [4301, 4302]);
  assert.deepEqual(explicitWorkerProcessPids(run({ rawObservations: { workerProcessPids: [4301, 4301, 4302] } })), [4301, 4302]);
});

test('generic PID collection ignores arbitrary numeric fields and current process identity', () => {
  const pids = [...collectObservedPids({
    worker: { pid: 4401, attempt: 4402 },
    nested: [{ pid: 4403 }, { eventId: 4404 }],
    current: { pid: process.pid }
  })].sort((a, b) => a - b);
  assert.deepEqual(pids, [4401, 4403]);
});
