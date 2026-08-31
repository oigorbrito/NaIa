import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessBenchmarkExecutionReadiness, assertBenchmarkExecutionReady } from './benchmark-execution-readiness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

test('current gate records DBOS coverage for all six critical mutants while keeping cross-candidate gaps explicit', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const result = assessBenchmarkExecutionReadiness(protocol, plan);

  assert.equal(result.ready, false);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_NOT_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.unsupportedCandidateMutants, [
    {
      candidate: 'Temporal TypeScript', mutantId: 'T11', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Temporal TypeScript', mutantId: 'T12', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Temporal TypeScript', mutantId: 'T16', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Restate', mutantId: 'T5', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript']
    },
    {
      candidate: 'Restate', mutantId: 'T11', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Restate', mutantId: 'T12', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Restate', mutantId: 'T16', mode: 'local-process',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T5', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['Temporal TypeScript', 'DBOS TypeScript']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T7', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: null
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T11', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T12', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    },
    {
      candidate: 'Trigger.dev', mutantId: 'T16', mode: 'managed-controller',
      supportedModes: ['local-process'], supportedCandidates: ['DBOS TypeScript']
    }
  ]);
});

test('readiness opens only when every critical mutant supports every candidate', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const completeSupport = Object.fromEntries(protocol.criticalMutants.map((mutantId) => [mutantId, {
    modes: ['local-process', 'managed-controller'],
    candidates: null,
    fault: `fixture-${mutantId}`
  }]));

  const result = assessBenchmarkExecutionReadiness(protocol, plan, completeSupport);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.unsupportedCandidateMutants, []);
  assert.equal(assertBenchmarkExecutionReady(protocol, plan, completeSupport).ready, true);
});

test('candidate allowlist is enforced independently of execution mode', () => {
  const protocol = { criticalMutants: ['T5'] };
  const plan = {
    criticalMutants: ['T5'],
    candidates: [
      { candidate: 'Temporal TypeScript', mode: 'local-process' },
      { candidate: 'DBOS TypeScript', mode: 'local-process' }
    ]
  };
  const support = { T5: { modes: ['local-process'], candidates: ['Temporal TypeScript'] } };
  const result = assessBenchmarkExecutionReadiness(protocol, plan, support);
  assert.equal(result.ready, false);
  assert.equal(result.unsupportedCandidateMutants.length, 1);
  assert.equal(result.unsupportedCandidateMutants[0].candidate, 'DBOS TypeScript');
});

test('assertBenchmarkExecutionReady fails closed with explicit remaining candidate gaps', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  assert.throws(
    () => assertBenchmarkExecutionReady(protocol, plan),
    /Temporal TypeScript\/T11: formal executor not implemented for candidate\/mode/
  );
});
