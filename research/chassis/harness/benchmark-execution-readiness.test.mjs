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

test('current benchmark execution gate is closed until all six critical mutant executors exist', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const result = assessBenchmarkExecutionReadiness(protocol, plan);

  assert.equal(result.ready, false);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_NOT_READY');
  assert.deepEqual(result.unsupportedMutants.sort(), ['T11', 'T12', 'T16', 'T5']);
  assert.deepEqual(result.incompatibleCandidateModes, [{
    candidate: 'Trigger.dev',
    mutantId: 'T7',
    mode: 'managed-controller',
    supportedModes: ['local-process']
  }]);
});

test('readiness gate opens only when every critical mutant supports every candidate mode', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const completeSupport = Object.fromEntries(protocol.criticalMutants.map((mutantId) => [mutantId, {
    modes: ['local-process', 'managed-controller'],
    fault: `fixture-${mutantId}`
  }]));

  const result = assessBenchmarkExecutionReadiness(protocol, plan, completeSupport);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'BENCHMARK_EXECUTION_READY');
  assert.deepEqual(result.unsupportedMutants, []);
  assert.deepEqual(result.incompatibleCandidateModes, []);
  assert.equal(assertBenchmarkExecutionReady(protocol, plan, completeSupport).ready, true);
});

test('assertBenchmarkExecutionReady fails closed with explicit missing executor reasons', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  assert.throws(
    () => assertBenchmarkExecutionReady(protocol, plan),
    /T5: formal executor not implemented/
  );
});
