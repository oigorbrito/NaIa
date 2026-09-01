import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeHarnessProvenance, FORMAL_HARNESS_FILES } from './harness-provenance.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-provenance-'));
  await mkdir(path.join(root, 'a'), { recursive: true });
  await writeFile(path.join(root, 'a', 'one.txt'), 'one\n');
  await writeFile(path.join(root, 'a', 'two.txt'), 'two\n');
  return root;
}

test('aggregate harness hash is deterministic independent of supplied file order', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await computeHarnessProvenance(root, ['a/two.txt', 'a/one.txt']);
  const second = await computeHarnessProvenance(root, ['a/one.txt', 'a/two.txt']);
  assert.equal(first.aggregateSha256, second.aggregateSha256);
  assert.deepEqual(first.files.map((entry) => entry.path), ['a/one.txt', 'a/two.txt']);
  assert.match(first.aggregateSha256, /^[a-f0-9]{64}$/);
});

test('aggregate harness hash changes if one bound component changes', async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await computeHarnessProvenance(root, ['a/one.txt', 'a/two.txt']);
  await writeFile(path.join(root, 'a', 'two.txt'), 'two changed\n');
  const after = await computeHarnessProvenance(root, ['a/one.txt', 'a/two.txt']);
  assert.notEqual(before.aggregateSha256, after.aggregateSha256);
  assert.notEqual(before.files[1].sha256, after.files[1].sha256);
});

test('formal provenance bundle includes runtime lifecycle, Git revision, environment, evaluators, schema, cleanup and promotion authorities', () => {
  for (const required of [
    'research/chassis/harness/harness-provenance.mjs',
    'research/chassis/harness/repository-provenance.mjs',
    'research/chassis/harness/formal-environment-identity.mjs',
    'research/chassis/harness/benchmark-execution-readiness.mjs',
    'research/chassis/harness/benchmark-promotion-gate.mjs',
    'research/chassis/harness/experiment-ledger-validator.mjs',
    'research/chassis/harness/experiment-record-schema-validator.mjs',
    'research/chassis/harness/experiment-record-validator.mjs',
    'research/chassis/harness/formal-cleanup-support.mjs',
    'research/chassis/harness/formal-dbos-lifecycle.mjs',
    'research/chassis/harness/formal-executor-support.mjs',
    'research/chassis/harness/formal-lifecycle-promotion-review.mjs',
    'research/chassis/harness/formal-lifecycle-qualification-provenance.mjs',
    'research/chassis/harness/formal-lifecycle-runtime-receipt-validator.mjs',
    'research/chassis/harness/formal-promotion-policy.mjs',
    'research/chassis/harness/formal-runtime-lifecycle.mjs',
    'research/chassis/harness/formal-runtime-lifecycle-router.mjs',
    'research/chassis/harness/formal-single-run.mjs',
    'research/chassis/harness/formal-worker-pid-provenance.mjs',
    'research/chassis/harness/t5-evaluator.mjs',
    'research/chassis/harness/t5-record-bridge.mjs',
    'research/chassis/harness/t7-t8-evaluator.mjs',
    'research/chassis/harness/t11-evaluator.mjs',
    'research/chassis/harness/t12-evaluator.mjs',
    'research/chassis/harness/t16-evaluator.mjs',
    'research/chassis/adapters/temporal-ts/package-lock.json',
    'research/chassis/adapters/temporal-ts/t5-activities.mjs',
    'research/chassis/adapters/temporal-ts/t5-two-worker-driver.mjs',
    'research/chassis/adapters/temporal-ts/t5-worker-process.mjs',
    'research/chassis/adapters/temporal-ts/t5-workflow.mjs',
    'research/chassis/adapters/dbos-ts/package-lock.json',
    'research/chassis/adapters/dbos-ts/t5-two-worker-driver.mjs',
    'research/chassis/adapters/dbos-ts/t5-worker-process.mjs',
    'research/chassis/adapters/dbos-ts/t5-workflow.mjs',
    'research/chassis/T5-OWNERSHIP-CONTRACT-V1.md',
    'research/chassis/critical-mutant-plan.v1.json',
    'research/chassis/formal-promotion-policy.v1.json'
  ]) {
    assert.ok(FORMAL_HARNESS_FILES.includes(required), required);
  }
  assert.equal(new Set(FORMAL_HARNESS_FILES).size, FORMAL_HARNESS_FILES.length);
});
