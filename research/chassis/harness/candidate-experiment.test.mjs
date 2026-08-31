import assert from 'node:assert/strict';
import test from 'node:test';
import { selectExperiment } from './candidate-experiment.mjs';

const plan = [
  { experimentId: 'temporal-t5-001', candidate: 'Temporal TypeScript', mutantId: 'T5', repetition: 1, randomSeed: 1050001 },
  { experimentId: 'dbos-t5-001', candidate: 'DBOS TypeScript', mutantId: 'T5', repetition: 1, randomSeed: 2050001 }
];

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
