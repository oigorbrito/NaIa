import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import { appendRecordToLedger, validateExecutionLedger, validateRecordAgainstSpec } from './experiment-ledger-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function blockedRecord(spec) {
  return {
    schemaVersion: 1,
    experimentId: spec.experimentId,
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    randomSeed: spec.randomSeed,
    setup: {
      status: 'BLOCKED_SETUP',
      candidateVersion: 'fixture-version',
      candidateSourceRef: 'fixture-source',
      adapterSha256: 'a'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      dependencyIdentity: null,
      environment: { os: 'fixture-os', arch: 'fixture-arch', runtime: 'node v22.0.0' },
      parameters: { randomSeed: spec.randomSeed },
      cleanupVerifiedBeforeRun: false
    },
    run: {
      startedAt: '2026-08-31T00:00:00.000Z',
      finishedAt: '2026-08-31T00:00:01.000Z',
      blocked: false,
      blocker: null,
      workload: {},
      fault: { intended: spec.mutantId, injected: false },
      rawObservations: {},
      acceptanceChecks: {}
    },
    cleanup: {
      status: 'NOT_APPLICABLE',
      workerCleanup: true,
      durableStateCleanup: true,
      oracleCleanup: true,
      temporaryResourcesCleanup: true
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'BLOCKED',
    blocker: 'DEPENDENCY_NOT_INSTALLED'
  };
}

test('empty ledger is a valid prefix and exposes the exact first preregistered experiment', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const validation = validateExecutionLedger([], protocol, suite);
  assert.equal(validation.valid, true);
  assert.equal(validation.complete, false);
  assert.equal(validation.expectedRecordCount, 2400);
  assert.deepEqual(validation.nextExpectedExperiment, {
    experimentId: 'temporal-typescript-t5-001',
    candidate: 'Temporal TypeScript',
    mutantId: 'T5',
    repetition: 1,
    randomSeed: 1050001
  });
});

test('record identity is bound to preregistered experimentId and random seed', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [spec] = buildExecutionPlan(protocol, suite);
  const record = blockedRecord(spec);
  assert.equal(validateRecordAgainstSpec(record, spec).valid, true);

  const tampered = structuredClone(record);
  tampered.randomSeed += 1;
  const validation = validateRecordAgainstSpec(tampered, spec);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /randomSeed mismatch/);
});

test('ledger rejects a valid record executed out of preregistered round-robin order', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const outOfOrder = blockedRecord(plan[1]);
  const validation = validateExecutionLedger([outOfOrder], protocol, suite);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /out-of-order record belongs at preregistered index 1/);
});

test('append refuses candidate substitution and accepts only the next exact record', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);

  assert.throws(
    () => appendRecordToLedger([], blockedRecord(plan[1]), protocol, suite),
    /record is not the next preregistered experiment/
  );

  const appended = appendRecordToLedger([], blockedRecord(plan[0]), protocol, suite);
  assert.equal(appended.validation.valid, true);
  assert.equal(appended.records.length, 1);
  assert.equal(appended.validation.nextExpectedExperiment.experimentId, plan[1].experimentId);
});

test('duplicate experimentId cannot occupy the next ledger slot', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const first = blockedRecord(plan[0]);
  const duplicate = structuredClone(first);
  const validation = validateExecutionLedger([first, duplicate], protocol, suite);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /duplicate experimentId/);
});
