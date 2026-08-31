import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPreflight } from './adapter-preflight.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

test('adapter static preflight passes without requiring runtime environment', async () => {
  const result = await runPreflight({ checkEnv: false });
  assert.equal(result.staticVerdict, 'PASS');
  assert.equal(result.benchmarkToBeat, 'NOT_SELECTED');
  assert.equal(result.chassisWinner, 'NOT_SELECTED');
  assert.equal(result.results.length, 4);
  for (const candidate of result.results) {
    assert.equal(candidate.staticVerdict, 'PASS', candidate.candidate);
  }
});

test('critical mutant execution plan covers every benchmark-critical mutant for every finalist', async () => {
  const faultSuite = await json('fault-suite.v1.json');
  const plan = await json('critical-mutant-plan.v1.json');
  const critical = faultSuite.mutants.filter((mutant) => mutant.critical).map((mutant) => mutant.id).sort();

  assert.deepEqual([...plan.criticalMutants].sort(), critical);
  assert.equal(plan.status, 'SPECIFIED_NOT_EXECUTED');
  assert.equal(plan.decisionState.benchmarkToBeat, 'NOT_SELECTED');
  assert.equal(plan.decisionState.chassisWinner, 'NOT_SELECTED');
  assert.equal(plan.candidates.length, 4);

  for (const candidate of plan.candidates) {
    assert.ok(candidate.workerKillTarget);
    assert.ok(candidate.durableAuthority);
    assert.deepEqual(Object.keys(candidate.mutants).sort(), critical);
    for (const mutantId of critical) {
      const mutant = candidate.mutants[mutantId];
      assert.equal(mutant.status, 'NOT_EXECUTED', `${candidate.candidate} ${mutantId}`);
      assert.ok(mutant.primitive, `${candidate.candidate} ${mutantId} primitive`);
      assert.ok(mutant.acceptance, `${candidate.candidate} ${mutantId} acceptance`);
      assert.ok(Array.isArray(mutant.blockedBy), `${candidate.candidate} ${mutantId} blockers`);
    }
  }
});

test('managed-controller candidate cannot claim T7 without worker hook', async () => {
  const plan = await json('critical-mutant-plan.v1.json');
  const trigger = plan.candidates.find((candidate) => candidate.candidate === 'Trigger.dev');
  assert.ok(trigger);
  assert.equal(trigger.mode, 'managed-controller');
  assert.equal(trigger.mutants.T7.status, 'NOT_EXECUTED');
  assert.ok(trigger.mutants.T7.blockedBy.includes('B003'));
  assert.match(trigger.workerKillTarget, /worker|task process|container/i);
  assert.match(trigger.workerKillTarget, /controller adapter is explicitly not a valid T7 kill target/i);
});
