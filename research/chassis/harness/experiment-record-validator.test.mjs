import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExperimentRecord, benchmarkEligible } from './experiment-record-validator.mjs';
import {
  completeCandidateRecords,
  faultSuite as makeSuite,
  readyFormalRecord,
  verifiedCleanupSupport
} from './formal-test-fixtures.mjs';

const REPOSITORY_REVISION = '1'.repeat(40);
const verifiedSupport = verifiedCleanupSupport(['Temporal TypeScript'], REPOSITORY_REVISION);

function record(overrides = {}) {
  const mutantId = overrides.mutantId ?? 'T7';
  const repetition = overrides.repetition ?? 1;
  const workerPid = overrides.pid ?? 8801;
  const value = readyFormalRecord({
    candidate: 'Temporal TypeScript',
    mutantId,
    repetition,
    repositoryRevision: REPOSITORY_REVISION,
    harnessSha256: overrides.harnessSha256 ?? 'b'.repeat(64),
    runtime: overrides.runtime ?? 'node v22.16.0',
    workerPid,
    receiptOverrides: overrides.receiptOverrides ?? {},
    dependencyIdentityOverrides: overrides.installedVersion
      ? {
          ...readyFormalRecord({ candidate: 'Temporal TypeScript' }).setup.dependencyIdentity,
          packages: readyFormalRecord({ candidate: 'Temporal TypeScript' }).setup.dependencyIdentity.packages.map((entry) => ({
            ...entry,
            installedVersion: overrides.installedVersion
          }))
        }
      : null,
    setupOverrides: overrides.missingPreRunReceipt ? { preRunCleanupReceipt: null } : {},
    cleanupOverrides: {
      liveObservedWorkerPids: overrides.liveWorker ? [workerPid] : []
    }
  });

  value.experimentId = overrides.experimentId ?? 'exp-1';
  value.randomSeed = overrides.randomSeed ?? 1001;

  if (overrides.unverifiedRepository) {
    value.setup.environment.repositoryProvenance = {
      source: 'git', status: 'UNVERIFIED', revision: REPOSITORY_REVISION,
      trackedWorktreeClean: false, reason: 'TRACKED_WORKTREE_DIRTY'
    };
  }
  if (overrides.tamperPromotionPolicy) value.setup.environment.formalPromotionPolicy.sha256 = '0'.repeat(64);
  if (overrides.tamperLifecycleQualification) value.setup.environment.formalLifecycleQualification.sha256 = '0'.repeat(64);

  const driverPid = 8899;
  if (overrides.withWorkerPid === false) {
    value.run.rawObservations = overrides.driverOnly ? { runnerProcess: { pid: driverPid } } : {};
    value.cleanup.observedWorkerPids = overrides.driverOnly ? [driverPid] : [];
  } else {
    value.run.rawObservations.runnerProcess = { pid: driverPid };
    value.cleanup.observedWorkerPids = [workerPid, driverPid];
  }
  if (overrides.omitWorkerFromCleanup) value.cleanup.observedWorkerPids = [driverPid];

  return value;
}

function suite(minRepetitions = 100, required = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16']) {
  return makeSuite(required, minRepetitions);
}

function completeRecords(minRepetitions = 100) {
  return completeCandidateRecords('Temporal TypeScript', minRepetitions);
}

test('accepts an executed critical PASS with provenance', () => {
  const result = validateExperimentRecord(record());
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('setup blocker cannot be candidate FAIL', () => {
  const value = record();
  value.setup.status = 'BLOCKED_SETUP';
  value.setup.cleanupVerifiedBeforeRun = false;
  value.verdict = 'FAIL';
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /BLOCKED_SETUP must yield BLOCKED/);
});

test('missing fault injection cannot become PASS', () => {
  const value = record();
  value.run.fault.injected = false;
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /INCONCLUSIVE/);
});

test('FAIL requires an observed failed acceptance check', () => {
  const value = record();
  value.verdict = 'FAIL';
  value.run.acceptanceChecks = { noDuplicate: false };
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('random seed must be a reproducible non-negative integer when supplied', () => {
  const value = record();
  value.randomSeed = -1;
  const result = validateExperimentRecord(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /randomSeed/);
});

test('benchmark eligibility rejects missing required mutant records', () => {
  const result = benchmarkEligible([record()], suite(1, ['T5', 'T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /T5: no executed records/);
});

test('benchmark eligibility enforces declared minimum unique repetitions', () => {
  const result = benchmarkEligible(completeRecords(99), suite(100), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /requires at least 100 unique repetitions, found 99/);
  assert.match(result.errors.join('\n'), /missing required repetition 100/);
});

test('benchmark eligibility rejects duplicate repetitions presented as replication', () => {
  const records = completeRecords(100);
  records.push(record({ experimentId: 'duplicate-T7-1', mutantId: 'T7', repetition: 1, randomSeed: 999999, pid: 9999 }));
  const result = benchmarkEligible(records, suite(100), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /T7: duplicate repetition 1/);
});

test('benchmark eligibility rejects record without verified clean Git repository revision provenance', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', unverifiedRepository: true })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks verified clean Git repository revision provenance/);
});

test('benchmark eligibility rejects record bound to a different promotion policy hash', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', tamperPromotionPolicy: true })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks current frozen formal promotion policy hash provenance/);
});

test('benchmark eligibility rejects record bound to a stale lifecycle qualification bundle', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', tamperLifecycleQualification: true })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks current candidate lifecycle qualification bundle provenance/);
});

test('benchmark eligibility rejects READY record without complete pre-run cleanup receipt', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', missingPreRunReceipt: true })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks complete PASS pre-run cleanup receipt/);
  assert.match(result.errors.join('\n'), /formal environment identity|native runtime identity/);
});

test('benchmark eligibility rejects mixed Node runtime identity even with one Git revision and one harness', () => {
  const records = [
    record({ experimentId: 'T7-1', mutantId: 'T7', repetition: 1, runtime: 'node v22.16.0' }),
    record({ experimentId: 'T7-2', mutantId: 'T7', repetition: 2, runtime: 'node v24.0.0', pid: 8802 })
  ];
  const result = benchmarkEligible(records, suite(2, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /multiple common execution environment identities/);
});

test('benchmark eligibility rejects candidate dependency drift before treating it as replication', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', installedVersion: '1.24.0' })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /expected, declared and installed versions must match exactly/);
});

test('benchmark eligibility rejects injected critical record without explicit worker PID provenance', () => {
  const result = benchmarkEligible([record({ mutantId: 'T7', withWorkerPid: false })], suite(1, ['T7']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks explicit worker process PID provenance/);
});

test('benchmark eligibility rejects driver PID as a substitute for explicit worker PID provenance', () => {
  const result = benchmarkEligible([record({ mutantId: 'T11', withWorkerPid: false, driverOnly: true })], suite(1, ['T11']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks explicit worker process PID provenance/);
});

test('benchmark eligibility rejects worker PID omitted from cleanup observation', () => {
  const result = benchmarkEligible([record({ mutantId: 'T12', omitWorkerFromCleanup: true })], suite(1, ['T12']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /cleanup evidence omitted explicit worker process PIDs/);
});

test('benchmark eligibility rejects worker PID reported alive after cleanup', () => {
  const result = benchmarkEligible([record({ mutantId: 'T16', liveWorker: true })], suite(1, ['T16']), verifiedSupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /still alive/);
});

test('benchmark eligibility rejects a READY record whose native runtime differs from the lifecycle qualification runtime', () => {
  const result = benchmarkEligible(
    [record({ mutantId: 'T7', receiptOverrides: { cliSha256: '7'.repeat(64) } })],
    suite(1, ['T7']),
    verifiedSupport
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity/);
});

test('benchmark eligibility remains closed when support evidence omits harness hash', () => {
  const withoutHarness = structuredClone(verifiedSupport);
  delete withoutHarness['Temporal TypeScript'].verificationEvidence.harnessSha256;
  const result = benchmarkEligible(completeRecords(1), suite(1), withoutHarness);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility remains closed when support evidence omits lifecycle qualification hash', () => {
  const withoutQualification = structuredClone(verifiedSupport);
  delete withoutQualification['Temporal TypeScript'].verificationEvidence.lifecycleQualificationSha256;
  const result = benchmarkEligible(completeRecords(1), suite(1), withoutQualification);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility remains closed when support evidence omits native runtime identity hash', () => {
  const withoutRuntimeIdentity = structuredClone(verifiedSupport);
  delete withoutRuntimeIdentity['Temporal TypeScript'].verificationEvidence.runtimeIdentitySha256;
  const result = benchmarkEligible(completeRecords(1), suite(1), withoutRuntimeIdentity);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility remains closed when support evidence omits repository revision', () => {
  const withoutRevision = structuredClone(verifiedSupport);
  delete withoutRevision['Temporal TypeScript'].verificationEvidence.repositoryRevision;
  const result = benchmarkEligible(completeRecords(1), suite(1), withoutRevision);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility remains closed when support execution ref points to a different repository revision', () => {
  const mismatched = structuredClone(verifiedSupport);
  mismatched['Temporal TypeScript'].verificationEvidence.executionRef = `github-actions:run=fixture;job=temporal;sha=${'2'.repeat(40)}`;
  const result = benchmarkEligible(completeRecords(1), suite(1), mismatched);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility remains closed when support booleans are true but receipt evidence is missing', () => {
  const booleanOnlySupport = {
    'Temporal TypeScript': { preRunCleanup: true, postRunCleanup: true, status: 'RUNTIME_VERIFIED', verificationEvidence: null }
  };
  const result = benchmarkEligible(completeRecords(1), suite(1), booleanOnlySupport);
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /evidence-backed RUNTIME_VERIFIED formal cleanup support/);
});

test('benchmark eligibility accepts complete critical coverage only with frozen policy, current lifecycle bundle, verified Git revision, stable formal environment, qualified native runtime identity, pre-run receipt, evidence-backed cleanup support and worker PID cleanup binding', () => {
  const result = benchmarkEligible(completeRecords(100), suite(100), verifiedSupport);
  assert.equal(result.eligible, true, result.errors.join('\n'));
});
