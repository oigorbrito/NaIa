import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWorkerPidCleanup, collectObservedPids, workerPidProvenanceRequired } from './formal-worker-pid-provenance.mjs';

function run({ injected = true, rawObservations = {} } = {}) {
  return {
    fault: { intended: 'T5', injected },
    rawObservations
  };
}

test('critical READY execution with injected fault requires observed PID provenance', () => {
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
  assert.deepEqual(result.observedPids, []);
});

test('critical READY execution passes PID cleanup only after at least one observed PID is dead', () => {
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T11',
    run: run({ rawObservations: { workerA: { pid: 4101 }, workerB: { pid: 4102 } } }),
    pidAlive: () => false
  });
  assert.equal(result.provenanceObserved, true);
  assert.equal(result.workerCleanup, true);
  assert.deepEqual(result.observedPids.sort((a, b) => a - b), [4101, 4102]);
  assert.deepEqual(result.liveObservedPids, []);
});

test('observed live PID keeps worker cleanup closed', () => {
  const result = assessWorkerPidCleanup({
    setupStatus: 'READY',
    mutantId: 'T12',
    run: run({ rawObservations: { worker: { pid: 4201 } } }),
    pidAlive: (pid) => pid === 4201
  });
  assert.equal(result.provenanceObserved, true);
  assert.equal(result.workerCleanup, false);
  assert.deepEqual(result.liveObservedPids, [4201]);
});

test('uninjected or blocked execution does not invent a cleanup failure solely because no PID exists', () => {
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

test('PID collection ignores arbitrary numeric fields and current process identity', () => {
  const pids = [...collectObservedPids({
    worker: { pid: 4301, attempt: 4302 },
    nested: [{ pid: 4303 }, { eventId: 4304 }],
    current: { pid: process.pid }
  })].sort((a, b) => a - b);
  assert.deepEqual(pids, [4301, 4303]);
});
