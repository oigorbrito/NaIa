import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildExecutionPlan } from './experiment-executor.mjs';
import {
  appendRecordToLedger,
  assessStoredFormalLedgerCurrentCompatibility,
  assessStoredFormalRecordCurrentCompatibility,
  auditStoredFormalLedger,
  auditStoredFormalRecord,
  validateExecutionLedger,
  validateRecordAgainstSpec
} from './experiment-ledger-validator.mjs';
import {
  currentLifecycleQualificationProvenance,
  currentLifecycleQualificationSha256
} from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chassisRoot = path.resolve(here, '..');
const REPOSITORY_REVISION = '1'.repeat(40);

async function json(name) {
  return JSON.parse(await readFile(path.join(chassisRoot, name), 'utf8'));
}

function qualificationRecord(candidate) {
  const value = currentLifecycleQualificationProvenance(candidate);
  return value ? {
    profile: value.profile,
    candidate: value.candidate,
    sha256: value.aggregateSha256,
    fileCount: value.fileCount
  } : null;
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
        repositoryProvenance: {
          source: 'git', status: 'VERIFIED', revision: REPOSITORY_REVISION,
          trackedWorktreeClean: true, reason: null
        },
        formalPromotionPolicy: formalPromotionPolicyProvenance(),
        formalLifecycleQualification: qualificationRecord(spec.candidate),
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
      executionRef: `github-actions:run=fixture;job=temporal;sha=${REPOSITORY_REVISION}`,
      repositoryRevision: REPOSITORY_REVISION,
      experimentId: 'temporal-typescript-t5-001',
      mutantId: 'T5',
      repetition: 1,
      recordSha256: 'd'.repeat(64),
      validatorSha256: 'e'.repeat(64),
      harnessSha256: 'b'.repeat(64),
      lifecycleQualificationSha256: currentLifecycleQualificationSha256('Temporal TypeScript'),
      verifiedAt: '2026-09-01T00:00:00.000Z'
    }
  }
};

test('empty ledger is a valid structural, historical and current-compatible prefix', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const validation = validateExecutionLedger([], protocol, suite);
  const formalAudit = auditStoredFormalLedger([]);
  const compatibility = assessStoredFormalLedgerCurrentCompatibility([]);
  assert.equal(validation.valid, true);
  assert.equal(formalAudit.valid, true);
  assert.equal(compatibility.compatible, true);
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
  assert.equal(assessStoredFormalRecordCurrentCompatibility(record).compatible, true);

  const tampered = structuredClone(record);
  tampered.randomSeed += 1;
  const validation = validateRecordAgainstSpec(tampered, spec);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /randomSeed mismatch/);
});

test('historical audit rejects malformed Git repository provenance', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [spec] = buildExecutionPlan(protocol, suite);
  const malformed = blockedRecord(spec);
  malformed.setup.environment.repositoryProvenance.revision = 'not-a-revision';
  const historical = auditStoredFormalRecord(malformed);
  assert.equal(historical.valid, false);
  assert.match(historical.errors.join('\n'), /lacks structurally valid Git repository provenance/);
});

test('historical audit preserves a well-formed old promotion policy hash while current compatibility rejects it', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [spec] = buildExecutionPlan(protocol, suite);
  const oldRecord = blockedRecord(spec);
  oldRecord.setup.environment.formalPromotionPolicy.sha256 = '0'.repeat(64);
  const historical = auditStoredFormalRecord(oldRecord);
  const compatibility = assessStoredFormalRecordCurrentCompatibility(oldRecord);
  assert.equal(historical.valid, true, historical.errors.join('\n'));
  assert.equal(compatibility.compatible, false);
  assert.match(compatibility.errors.join('\n'), /promotion policy differs from current frozen promotion policy/);
});

test('historical audit rejects malformed promotion policy provenance rather than treating it as an old valid hash', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [spec] = buildExecutionPlan(protocol, suite);
  const malformed = blockedRecord(spec);
  malformed.setup.environment.formalPromotionPolicy.sha256 = 'not-a-sha';
  const historical = auditStoredFormalRecord(malformed);
  assert.equal(historical.valid, false);
  assert.match(historical.errors.join('\n'), /lacks structurally valid promotion policy provenance/);
});

test('historical audit preserves a well-formed old lifecycle bundle while current compatibility rejects it', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [spec] = buildExecutionPlan(protocol, suite);
  const oldRecord = blockedRecord(spec);
  oldRecord.setup.environment.formalLifecycleQualification.sha256 = '0'.repeat(64);
  const historical = auditStoredFormalRecord(oldRecord);
  const compatibility = assessStoredFormalRecordCurrentCompatibility(oldRecord);
  assert.equal(historical.valid, true, historical.errors.join('\n'));
  assert.equal(compatibility.compatible, false);
  assert.match(compatibility.errors.join('\n'), /lifecycle qualification bundle differs from current qualification bundle/);
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

test('hypothetical verified support accepts only the exact current-compatible next record without changing repository gate state', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const appended = appendRecordToLedger([], blockedRecord(plan[0]), protocol, suite, { cleanupSupport: verifiedTemporalSupport });
  assert.equal(appended.validation.valid, true);
  assert.equal(appended.formalAudit.valid, true);
  assert.equal(appended.currentCompatibility.compatible, true);
  assert.equal(appended.records.length, 1);
  assert.equal(appended.validation.nextExpectedExperiment.experimentId, plan[1].experimentId);
});

test('hypothetical support without lifecycle qualification hash cannot open append admission', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [first] = buildExecutionPlan(protocol, suite);
  const support = structuredClone(verifiedTemporalSupport);
  delete support['Temporal TypeScript'].verificationEvidence.lifecycleQualificationSha256;
  assert.throws(
    () => appendRecordToLedger([], blockedRecord(first), protocol, suite, { cleanupSupport: support }),
    /formal cleanup support is not runtime-verified/
  );
});

test('hypothetical support with mismatched Git execution revision cannot open append admission', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const [first] = buildExecutionPlan(protocol, suite);
  const support = structuredClone(verifiedTemporalSupport);
  support['Temporal TypeScript'].verificationEvidence.executionRef = `github-actions:run=fixture;job=temporal;sha=${'2'.repeat(40)}`;
  assert.throws(
    () => appendRecordToLedger([], blockedRecord(first), protocol, suite, { cleanupSupport: support }),
    /formal cleanup support is not runtime-verified/
  );
});

test('historical audit rejects lifecycle provenance removed after admission', async () => {
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
    /existing formal ledger historical provenance is invalid/
  );
});

test('well-formed old policy provenance stays historically valid but closes further append as current-incompatible', async () => {
  const protocol = await json('experiment-protocol.v1.json');
  const suite = await json('fault-suite.v1.json');
  const plan = buildExecutionPlan(protocol, suite);
  const appended = appendRecordToLedger([], blockedRecord(plan[0]), protocol, suite, { cleanupSupport: verifiedTemporalSupport });
  const oldPrefix = structuredClone(appended.records);
  oldPrefix[0].setup.environment.formalPromotionPolicy.sha256 = 'f'.repeat(64);

  const historical = auditStoredFormalLedger(oldPrefix);
  const compatibility = assessStoredFormalLedgerCurrentCompatibility(oldPrefix);
  assert.equal(historical.valid, true, historical.errors.join('\n'));
  assert.equal(compatibility.compatible, false);

  assert.throws(
    () => appendRecordToLedger(oldPrefix, blockedRecord(plan[1]), protocol, suite, { cleanupSupport: verifiedTemporalSupport }),
    /existing formal ledger is incompatible with current frozen qualification\/promotion state/
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
