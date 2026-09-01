import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveSeed, validateExperimentProtocol } from './experiment-protocol-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassis = path.resolve(here, '..');
const REVISION_POLICY = 'single-verified-git-revision-per-formal-ledger';

async function json(name) {
  return JSON.parse(await readFile(path.join(chassis, name), 'utf8'));
}

test('protocol matches fault-suite, freezes revision comparability before execution and declares the full critical experiment population', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.expectedExperiments, 4 * 6 * 100);
  assert.equal(result.uniqueSeeds, 4 * 6 * 100);
  assert.equal(protocol.executionOrder.repositoryRevisionPolicy, REVISION_POLICY);
  const amendment = protocol.methodology.preExecutionAmendments.find((entry) => entry.id === 'A001');
  assert.equal(amendment.status, 'FROZEN_BEFORE_FORMAL_EXECUTION');
  assert.equal(amendment.policy, REVISION_POLICY);
  assert.equal(amendment.outcomeDriven, false);
  assert.equal(amendment.changesSemanticVerdicts, false);
  assert.equal(amendment.changesRepetitionThreshold, false);
  assert.equal(amendment.lifecycleQualificationMayPrecedeBenchmarkRevision, true);
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

test('protocol validation rejects silent removal of the frozen single-revision execution policy', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  delete protocol.executionOrder.repositoryRevisionPolicy;
  const result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /executionOrder\.repositoryRevisionPolicy must equal/);
});

test('protocol validation rejects removal or post-hoc mutation of A001', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  protocol.methodology.preExecutionAmendments = [];
  let result = validateExperimentProtocol(protocol, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A001: frozen pre-execution repository revision amendment is required/);

  const mutated = await json('experiment-protocol.v1.json');
  mutated.methodology.preExecutionAmendments[0].outcomeDriven = true;
  mutated.methodology.preExecutionAmendments[0].changesRepetitionThreshold = true;
  result = validateExperimentProtocol(mutated, suite);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /A001: outcomeDriven must be false/);
  assert.match(result.errors.join('\n'), /A001: changesRepetitionThreshold must be false/);
});
