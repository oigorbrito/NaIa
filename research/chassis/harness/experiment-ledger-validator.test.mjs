import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import {
  appendRecordToLedger,
  auditStoredFormalLedger,
  auditStoredFormalRecord,
  validateExecutionLedger,
  validateRecordAgainstSpec
} from './experiment-ledger-validator.mjs';

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
      environment: {
        os: 'fixture-os', arch: 'fixture-arch', runtime: 'node v22.0.0',
        formalRuntimeLifecycle: { candidate: spec.candidate, status: 'RUNTIME_VERIFIED' }
      },
      parameters: { randomSeed: spec.randomSeed },
      cleanupVerifiedBeforeRun: false,
      preRunCleanupReceipt: null
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
      temporaryResourcesCleanup: true,
      observedWorkerPids: [],
      liveObservedWorkerPids: []
    },
    artifacts: [{ name: 'fixture.json', path: null, sha256: 'c'.repeat(64) }],
    verdict: 'BLOCKED',
    blocker: 'DEPENDENCY_NOT_INSTALLED'
  };
}

const verifiedTemporalSupport = {
  'Temporal TypeScript': {
    preRunCleanup: true,
    postRunCleanup: true,
    status: 'RUNTIME_VERIFIED',
    verificationEvidence: {
      executionRef: 'test:temporal-runtime-receipt',
      experimentId: 'temporal-typescript-t5-001',
      mutantId: 'T5',
      repetition: 1,
      recordSha256: 'd'.repeat(64),
      validatorSha256: 'e'.repeat(64),
      verifiedAt: '2026-09-01T00:00:00.000Z'
    }
  }
};

test('empty ledger is a valid structural and immutable-formal prefix', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const validation = validateExecutionLedger([], protocol, suite);
  const formalAudit = auditStoredFormalLedger([]);
  assert.equal(validation.valid, true);
  assert.equal(formalAudit.valid, true);
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
  assert.equal(auditStoredFormalRecord(record).valid, true);

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

test('append refuses candidate substitution before formal admission', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);

  assert.throws(
    () => appendRecordToLedger([], blockedRecord(plan[1]), protocol, suite, { cleanupSupport: verifiedTemporalSupport }),
    /record is not the next preregistered experiment/
  );
});

test('real append gate remains closed while repository cleanup support is unverified', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [first] = buildExecutionPlan(protocol, suite);
  assert.throws(
    () => appendRecordToLedger([], blockedRecord(first), protocol, suite),
    /formal cleanup support is not runtime-verified/
  );
});

test('hypothetical verified support accepts only the exact next record without changing repository gate state', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const appended = appendRecordToLedger([], blockedRecord(plan[0]), protocol, suite, { cleanupSupport: verifiedTemporalSupport });
  assert.equal(appended.validation.valid, true);
  assert.equal(appended.formalAudit.valid, true);
  assert.equal(appended.records.length, 1);
  assert.equal(appended.validation.nextExpectedExperiment.experimentId, plan[1].experimentId);
});

test('immutable formal audit rejects stored lifecycle provenance removed after admission', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const first = blockedRecord(plan[0]);
  const appended = appendRecordToLedger([], first, protocol, suite, { cleanupSupport: verifiedTemporalSupport });
  const tamperedPrefix = structuredClone(appended.records);
  tamperedPrefix[0].setup.environment.formalRuntimeLifecycle.status = 'IMPLEMENTED_NOT_RUNTIME_VERIFIED';

  const audit = auditStoredFormalLedger(tamperedPrefix);
  assert.equal(audit.valid, false);
  assert.match(audit.errors.join('\n'), /lacks immutable RUNTIME_VERIFIED lifecycle provenance/);

  assert.throws(
    () => appendRecordToLedger(tamperedPrefix, blockedRecord(plan[1]), protocol, suite, { cleanupSupport: verifiedTemporalSupport }),
    /existing formal ledger immutable provenance is invalid/
  );
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
