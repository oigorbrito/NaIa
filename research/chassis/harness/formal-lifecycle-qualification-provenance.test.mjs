import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FORMAL_LIFECYCLE_QUALIFICATION_FILES,
  FORMAL_LIFECYCLE_QUALIFICATION_PROFILE,
  computeLifecycleQualificationProvenance,
  lifecycleQualificationFiles,
  lifecycleQualificationRecordProvenanceStructurallyValid,
  lifecycleQualificationRecordProvenanceValid
} from './formal-lifecycle-qualification-provenance.mjs';

async function syntheticRepository(candidate) {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-lifecycle-qualification-'));
  const files = lifecycleQualificationFiles(candidate);
  for (const relativePath of files) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `fixture:${relativePath}\n`);
  }
  return root;
}

function recordView(provenance) {
  return {
    profile: provenance.profile,
    candidate: provenance.candidate,
    sha256: provenance.aggregateSha256,
    fileCount: provenance.fileCount
  };
}

test('Temporal and DBOS lifecycle qualification bundles are candidate-specific and include frozen dependency graphs', () => {
  const temporal = FORMAL_LIFECYCLE_QUALIFICATION_FILES['Temporal TypeScript'];
  const dbos = FORMAL_LIFECYCLE_QUALIFICATION_FILES['DBOS TypeScript'];

  assert.ok(temporal.includes('research/chassis/harness/formal-runtime-lifecycle.mjs'));
  assert.ok(temporal.includes('research/chassis/adapters/temporal-ts/package-lock.json'));
  assert.ok(temporal.includes('research/chassis/adapters/temporal-ts/t5-two-worker-driver.mjs'));
  assert.ok(dbos.includes('research/chassis/harness/formal-dbos-lifecycle.mjs'));
  assert.ok(dbos.includes('research/chassis/adapters/dbos-ts/package-lock.json'));
  assert.ok(dbos.includes('research/chassis/adapters/dbos-ts/t5-two-worker-driver.mjs'));
  assert.ok(temporal.includes('research/chassis/harness/formal-lifecycle-runtime-receipt-validator.mjs'));
  assert.ok(dbos.includes('research/chassis/harness/formal-lifecycle-promotion-review.mjs'));
  assert.equal(temporal.includes('research/chassis/harness/formal-cleanup-support.mjs'), false);
  assert.equal(dbos.includes('research/chassis/harness/formal-cleanup-support.mjs'), false);
});

test('qualification aggregate changes when an included runtime file changes', async (t) => {
  const root = await syntheticRepository('Temporal TypeScript');
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = computeLifecycleQualificationProvenance(root, 'Temporal TypeScript');
  const worker = path.join(root, 'research/chassis/adapters/temporal-ts/t5-worker-process.mjs');
  await writeFile(worker, 'fixture:changed-worker-runtime\n');
  const after = computeLifecycleQualificationProvenance(root, 'Temporal TypeScript');

  assert.equal(before.profile, FORMAL_LIFECYCLE_QUALIFICATION_PROFILE);
  assert.notEqual(before.aggregateSha256, after.aggregateSha256);
});

test('qualification aggregate is stable when only mutable cleanup support registry changes', async (t) => {
  const root = await syntheticRepository('DBOS TypeScript');
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = computeLifecycleQualificationProvenance(root, 'DBOS TypeScript');
  const support = path.join(root, 'research/chassis/harness/formal-cleanup-support.mjs');
  await mkdir(path.dirname(support), { recursive: true });
  await writeFile(support, 'support-state:v1\n');
  const middle = computeLifecycleQualificationProvenance(root, 'DBOS TypeScript');
  await writeFile(support, 'support-state:v2\n');
  const after = computeLifecycleQualificationProvenance(root, 'DBOS TypeScript');

  assert.equal(before.aggregateSha256, middle.aggregateSha256);
  assert.equal(middle.aggregateSha256, after.aggregateSha256);
});

test('historical shape validation is distinct from current expected-hash compatibility', async (t) => {
  const root = await syntheticRepository('Temporal TypeScript');
  t.after(() => rm(root, { recursive: true, force: true }));
  const provenance = computeLifecycleQualificationProvenance(root, 'Temporal TypeScript');
  const value = recordView(provenance);

  assert.equal(lifecycleQualificationRecordProvenanceStructurallyValid(value, 'Temporal TypeScript'), true);
  assert.equal(lifecycleQualificationRecordProvenanceValid(value, 'Temporal TypeScript', provenance.aggregateSha256), true);

  const old = { ...value, sha256: '0'.repeat(64) };
  assert.equal(lifecycleQualificationRecordProvenanceStructurallyValid(old, 'Temporal TypeScript'), true);
  assert.equal(lifecycleQualificationRecordProvenanceValid(old, 'Temporal TypeScript', provenance.aggregateSha256), false);
});

test('unsupported candidate has no fabricated lifecycle qualification bundle', () => {
  assert.equal(lifecycleQualificationFiles('Trigger.dev'), null);
  assert.equal(lifecycleQualificationFiles('Restate'), null);
});
