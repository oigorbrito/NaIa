import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBenchmarkRepositoryRevisionConsistency } from './benchmark-promotion-gate.mjs';
import { benchmarkEligible } from './experiment-record-validator.mjs';
import {
  readyFormalRecord,
  verifiedCleanupSupport
} from './formal-test-fixtures.mjs';

const REVISION_A = '1'.repeat(40);
const REVISION_B = '2'.repeat(40);
const SUPPORT_REVISION = '3'.repeat(40);
const HARNESS_A = 'e'.repeat(64);
const HARNESS_B = '9'.repeat(64);

function support() {
  return verifiedCleanupSupport(['Temporal TypeScript'], SUPPORT_REVISION);
}

function t7Record(repetition, repositoryRevision, harnessSha256 = HARNESS_A, overrides = {}) {
  return readyFormalRecord({
    candidate: 'Temporal TypeScript',
    mutantId: 'T7',
    repetition,
    repositoryRevision,
    harnessSha256,
    runtime: overrides.runtime ?? 'node v22.16.0',
    os: overrides.os ?? 'linux 6.11.0',
    arch: overrides.arch ?? 'x64',
    receiptOverrides: overrides.versionOutput
      ? { versionOutput: overrides.versionOutput }
      : {}
  });
}

const t7Suite = {
  mutants: [{ id: 'T7', critical: true, minRepetitions: 2 }],
  benchmarkEligibility: { forbidBlockedOrInconclusive: ['T7'] }
};

test('candidate benchmark accepts repetitions from one frozen repository revision harness and environment identity even when lifecycle support was qualified earlier', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A)],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, true, result.errors.join('\n'));
  assert.equal(result.environmentConsistency.consistent, true);
});

test('candidate benchmark rejects repetitions mixed across repository revisions', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_B)],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /formal benchmark records span multiple Git repository revisions/);
});

test('candidate benchmark rejects repetitions with the same claimed repository revision but different harness identities', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A, HARNESS_A), t7Record(2, REVISION_A, HARNESS_B)],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /formal benchmark records span multiple harness identities/);
});

test('candidate benchmark rejects malformed harness identity rather than treating it as absent from consistency set', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A, 'not-a-sha'), t7Record(2, REVISION_A, 'not-a-sha')],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /lacks a valid formal harness SHA-256 identity/);
});

test('candidate benchmark rejects same revision and harness when Node runtime changes', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A, HARNESS_A, { runtime: 'node v24.0.0' })],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /multiple common execution environment identities/);
});

test('candidate benchmark rejects same revision harness and Node when native runtime profile changes', () => {
  const result = benchmarkEligible(
    [t7Record(1, REVISION_A), t7Record(2, REVISION_A, HARNESS_A, { versionOutput: 'Temporal CLI 1.8.1 Server 1.31.3' })],
    t7Suite,
    support()
  );
  assert.equal(result.eligible, false);
  assert.match(result.errors.join('\n'), /native runtime identity differs from lifecycle qualification runtime identity|multiple candidate execution profile identities/);
});

test('cross-candidate comparison reports one common revision only when every verified record shares it', () => {
  const same = assessBenchmarkRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } },
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.deepEqual(same, {
    consistent: true,
    repositoryRevision: REVISION_A,
    repositoryRevisions: [REVISION_A],
    errors: []
  });

  const mixed = assessBenchmarkRepositoryRevisionConsistency([
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_A, trackedWorktreeClean: true, reason: null } } } },
    { setup: { environment: { repositoryProvenance: { source: 'git', status: 'VERIFIED', revision: REVISION_B, trackedWorktreeClean: true, reason: null } } } }
  ]);
  assert.equal(mixed.consistent, false);
  assert.equal(mixed.repositoryRevision, null);
  assert.deepEqual(mixed.repositoryRevisions, [REVISION_A, REVISION_B]);
  assert.match(mixed.errors.join('\n'), /benchmark comparison spans multiple Git repository revisions/);
});
