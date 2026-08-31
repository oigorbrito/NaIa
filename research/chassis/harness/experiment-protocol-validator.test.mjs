import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveSeed, validateExperimentProtocol } from './experiment-protocol-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassis = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassis, name), 'utf8'));
}

test('protocol matches fault-suite and declares the full critical experiment population', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.expectedExperiments, 4 * 6 * 100);
  assert.equal(result.uniqueSeeds, 4 * 6 * 100);
});

test('seed derivation is stable for the same candidate mutant and repetition', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  assert.equal(deriveSeed(protocol, 'Temporal TypeScript', 'T7', 1), 1_070_001);
  assert.equal(deriveSeed(protocol, 'Trigger.dev', 'T16', 100), 4_160_100);
});

test('protocol validation rejects a repetition minimum below the fault-suite declaration', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.repetitionPolicy.minimumPerCriticalMutant = 99;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /protocol minimum does not match/);
});

test('protocol validation rejects seed ordinal collisions', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.repetitionPolicy.seedPolicy.candidateOrdinals['DBOS TypeScript'] = 1;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /candidate seed ordinals must be unique|seed collision/);
});
