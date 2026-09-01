import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPreRunCleanupGate,
  defaultCleanupResult,
  preRunCleanupReceiptValid,
  selectExperiment
} from './candidate-experiment.mjs';

const plan = [
  { experimentId: 'temporal-t5-001', candidate: 'Temporal TypeScript', mutantId: 'T5', repetition: 1, randomSeed: 1050001 },
  { experimentId: 'dbos-t5-001', candidate: 'DBOS TypeScript', mutantId: 'T5', repetition: 1, randomSeed: 2050001 }
];

const cleanReceipt = Object.freeze({
  status: 'PASS',
  workerCleanup: true,
  durableStateCleanup: true,
  oracleCleanup: true,
  temporaryResourcesCleanup: true,
  evidenceId: 'synthetic-clean-baseline'
});

test('selectExperiment resolves only preregistered identity', () => {
  const selected = selectExperiment(plan, { candidate: 'Temporal TypeScript', mutantId: 'T5', repetition: 1 });
  assert.equal(selected.experimentId, 'temporal-t5-001');
  assert.equal(selected.randomSeed, 1050001);
});

test('selectExperiment rejects an unregistered repetition', () => {
  assert.throws(
    () => selectExperiment(plan, { candidate: 'Temporal TypeScript', mutantId: 'T5', repetition: 2 }),
    /experiment not found in preregistered plan/
  );
});

test('selectExperiment rejects a candidate substitution', () => {
  assert.throws(
    () => selectExperiment(plan, { candidate: 'Restate', mutantId: 'T5', repetition: 1 }),
    /experiment not found in preregistered plan/
  );
});

test('pre-run cleanup receipt requires explicit PASS across every contamination boundary', () => {
  assert.equal(preRunCleanupReceiptValid(cleanReceipt), true);
  assert.equal(preRunCleanupReceiptValid({ ...cleanReceipt, durableStateCleanup: false }), false);
  assert.equal(preRunCleanupReceiptValid({ ...cleanReceipt, status: 'FAIL' }), false);
  assert.equal(preRunCleanupReceiptValid(null), false);
});

test('pre-run cleanup gate fails closed when cleanup evidence is absent', () => {
  const setup = applyPreRunCleanupGate({ status: 'READY', blocker: null, cleanupVerifiedBeforeRun: false, diagnostics: {} }, null);
  assert.equal(setup.status, 'BLOCKED_SETUP');
  assert.equal(setup.blocker, 'PRE_RUN_CLEANUP_NOT_VERIFIED');
  assert.equal(setup.cleanupVerifiedBeforeRun, false);
});

test('pre-run cleanup gate opens only with a complete cleanup receipt', () => {
  const setup = applyPreRunCleanupGate({ status: 'READY', blocker: null, cleanupVerifiedBeforeRun: false, diagnostics: {} }, cleanReceipt);
  assert.equal(setup.status, 'READY');
  assert.equal(setup.blocker, null);
  assert.equal(setup.cleanupVerifiedBeforeRun, true);
  assert.deepEqual(setup.diagnostics.preRunCleanupReceipt, cleanReceipt);
});

test('default cleanup is NOT_APPLICABLE only when setup prevented execution', () => {
  const result = defaultCleanupResult({ status: 'BLOCKED_SETUP' });
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.equal(result.workerCleanup, true);
  assert.equal(result.durableStateCleanup, true);
});

test('default cleanup fails closed after READY setup when cleanup hook is absent', () => {
  const result = defaultCleanupResult({ status: 'READY' });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.reason, 'CLEANUP_HOOK_NOT_CONFIGURED');
  assert.equal(result.workerCleanup, false);
  assert.equal(result.durableStateCleanup, false);
  assert.equal(result.oracleCleanup, false);
  assert.equal(result.temporaryResourcesCleanup, false);
});
