import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan, executeExperiment } from './experiment-executor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function setup(status = 'READY') {
  return {
    status,
    candidateVersion: '1.23.0',
    candidateSourceRef: 'source-ref',
    adapterSha256: 'a'.repeat(64),
    harnessSha256: 'b'.repeat(64),
    dependencyIdentity: { lockSha256: 'c'.repeat(64) },
    parameters: {},
    cleanupVerifiedBeforeRun: status === 'READY',
    blocker: status === 'BLOCKED_SETUP' ? 'DEPENDENCY_UNAVAILABLE' : null
  };
}

function cleanup(status = 'PASS') {
  return {
    status,
    workerCleanup: true,
    durableStateCleanup: true,
    oracleCleanup: true,
    temporaryResourcesCleanup: true
  };
}

function passRun() {
  return {
    workload: { objective: 'control' },
    fault: {
      intended: 'external effect persistence boundary',
      injected: true,
      targetKind: 'worker-process',
      targetIdentity: 1234,
      signal: 'SIGKILL',
      durableAuthorityAlive: true
    },
    rawObservations: { applyCount: 1 },
    acceptanceChecks: { noDuplicateExternalEffect: true, recoveryObserved: true }
  };
}

test('buildExecutionPlan materializes the pre-registered 2400 critical experiments', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  assert.equal(plan.length, 2400);
  assert.equal(new Set(plan.map((entry) => entry.experimentId)).size, 2400);
  assert.equal(new Set(plan.map((entry) => entry.randomSeed)).size, 2400);
  assert.deepEqual(plan[0], {
    experimentId: 'temporal-typescript-t5-001',
    candidate: 'Temporal TypeScript',
    mutantId: 'T5',
    repetition: 1,
    randomSeed: 1050001
  });
});

test('executor emits a valid PASS only from executed fault plus declared checks and provenance', async () => {
  const result = await executeExperiment({
    experimentId: 'temporal-typescript-t7-001',
    candidate: 'Temporal TypeScript', mutantId: 'T7', repetition: 1, randomSeed: 1070001
  }, {
    environment: { packageManager: 'npm 10' },
    setup: async () => setup(),
    run: async () => passRun(),
    cleanup: async () => cleanup(),
    artifacts: async () => [{ name: 'raw-events.json', content: '{"applyCount":1}' }]
  });

  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.verdict, 'PASS');
  assert.equal(result.record.setup.parameters.randomSeed, 1070001);
  assert.equal(result.record.artifacts.length, 1);
  assert.equal(result.record.artifacts[0].sha256.length, 64);
});

test('blocked setup never executes candidate run and remains BLOCKED', async () => {
  let runCalled = false;
  const result = await executeExperiment({
    experimentId: 'temporal-typescript-t7-002',
    candidate: 'Temporal TypeScript', mutantId: 'T7', repetition: 2, randomSeed: 1070002
  }, {
    setup: async () => setup('BLOCKED_SETUP'),
    run: async () => { runCalled = true; return passRun(); },
    cleanup: async () => cleanup('NOT_APPLICABLE')
  });

  assert.equal(runCalled, false);
  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.blocker, 'DEPENDENCY_UNAVAILABLE');
});

test('runtime bootstrap prerequisite discovered after READY setup remains BLOCKED, not INCONCLUSIVE', async () => {
  const result = await executeExperiment({
    experimentId: 'temporal-typescript-t7-005',
    candidate: 'Temporal TypeScript', mutantId: 'T7', repetition: 5, randomSeed: 1070005
  }, {
    setup: async () => setup(),
    run: async () => ({
      blocked: true,
      blocker: 'SERVER_UNREACHABLE_BEFORE_FAULT',
      workload: {},
      fault: {
        intended: 'T7', injected: false, targetKind: null, targetIdentity: null,
        signal: null, durableAuthorityAlive: false
      },
      rawObservations: { error: 'ECONNREFUSED 127.0.0.1:7233' },
      acceptanceChecks: {}
    }),
    cleanup: async () => cleanup('NOT_APPLICABLE')
  });

  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.setup.status, 'READY');
  assert.equal(result.record.run.blocked, true);
  assert.equal(result.record.verdict, 'BLOCKED');
  assert.equal(result.record.blocker, 'SERVER_UNREACHABLE_BEFORE_FAULT');
});

test('executor refuses to fabricate missing provenance', async () => {
  const incomplete = setup();
  delete incomplete.adapterSha256;
  delete incomplete.harnessSha256;
  const result = await executeExperiment({
    experimentId: 'temporal-typescript-t7-003',
    candidate: 'Temporal TypeScript', mutantId: 'T7', repetition: 3, randomSeed: 1070003
  }, {
    setup: async () => incomplete,
    run: async () => passRun(),
    cleanup: async () => cleanup()
  });

  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /adapterSha256 is required/);
  assert.match(result.validationErrors.join('\n'), /harnessSha256 is required/);
});

test('cleanup failure cannot be promoted to PASS', async () => {
  const result = await executeExperiment({
    experimentId: 'temporal-typescript-t7-004',
    candidate: 'Temporal TypeScript', mutantId: 'T7', repetition: 4, randomSeed: 1070004
  }, {
    setup: async () => setup(),
    run: async () => passRun(),
    cleanup: async () => cleanup('FAIL')
  });

  assert.equal(result.valid, true, result.validationErrors.join('\n'));
  assert.equal(result.record.verdict, 'INCONCLUSIVE');
});
