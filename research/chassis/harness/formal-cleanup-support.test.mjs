import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMAL_CLEANUP_SUPPORT,
  expectedLifecycleExperimentId,
  formalCleanupSupportsCandidate,
  runtimeVerificationEvidenceValid
} from './formal-cleanup-support.mjs';
import { currentLifecycleQualificationSha256 } from './formal-lifecycle-qualification-provenance.mjs';

const CANDIDATE = 'Temporal TypeScript';
const REVISION = '1'.repeat(40);

function evidence(candidate = CANDIDATE, overrides = {}) {
  return {
    executionRef: `github-actions:run=123;job=${candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()};sha=${REVISION}`,
    repositoryRevision: REVISION,
    experimentId: expectedLifecycleExperimentId(candidate),
    mutantId: 'T5',
    repetition: 1,
    recordSha256: 'a'.repeat(64),
    validatorSha256: 'b'.repeat(64),
    harnessSha256: 'c'.repeat(64),
    lifecycleQualificationSha256: currentLifecycleQualificationSha256(candidate),
    verifiedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function support(value, candidate = CANDIDATE) {
  return {
    [candidate]: {
      preRunCleanup: true,
      postRunCleanup: true,
      status: 'RUNTIME_VERIFIED',
      verificationEvidence: value
    }
  };
}

test('runtime verification evidence is valid only when execution ref and persisted repository revision identify the same full Git revision', () => {
  const value = evidence();
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), true);
  assert.equal(formalCleanupSupportsCandidate(support(value), CANDIDATE), true);
});

test('runtime verification evidence rejects missing repository revision', () => {
  const value = evidence();
  delete value.repositoryRevision;
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
  assert.equal(formalCleanupSupportsCandidate(support(value), CANDIDATE), false);
});

test('runtime verification evidence rejects execution ref bound to a different Git revision', () => {
  const value = evidence(CANDIDATE, {
    executionRef: `github-actions:run=123;job=temporal;sha=${'2'.repeat(40)}`
  });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects abbreviated Git revision in execution ref', () => {
  const value = evidence(CANDIDATE, { executionRef: 'github-actions:run=123;job=temporal;sha=abc1234' });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects another candidate lifecycle experiment identity', () => {
  const value = evidence(CANDIDATE, { experimentId: 'dbos-typescript-t5-001' });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects stale lifecycle qualification hash', () => {
  const value = evidence(CANDIDATE, { lifecycleQualificationSha256: '0'.repeat(64) });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('Restate cleanup implementation is registered but remains closed without runtime verification evidence', () => {
  const entry = FORMAL_CLEANUP_SUPPORT.Restate;
  assert.equal(entry.status, 'IMPLEMENTED_NOT_RUNTIME_VERIFIED');
  assert.equal(entry.preRunCleanup, false);
  assert.equal(entry.postRunCleanup, false);
  assert.equal(entry.verificationEvidence, null);
  assert.equal(entry.implementation, 'research/chassis/harness/formal-restate-lifecycle.mjs');
  assert.equal(formalCleanupSupportsCandidate(FORMAL_CLEANUP_SUPPORT, 'Restate'), false);
});

test('synthetic valid-shaped Restate verification evidence is recognized only when support phases and lifecycle state are explicitly promoted', () => {
  const value = evidence('Restate');
  assert.equal(runtimeVerificationEvidenceValid(value, 'Restate'), true);
  assert.equal(formalCleanupSupportsCandidate(support(value, 'Restate'), 'Restate'), true);
  assert.equal(formalCleanupSupportsCandidate(FORMAL_CLEANUP_SUPPORT, 'Restate'), false);
});

test('Trigger.dev remains not implemented and cannot inherit Restate cleanup support', () => {
  const entry = FORMAL_CLEANUP_SUPPORT['Trigger.dev'];
  assert.equal(entry.status, 'NOT_IMPLEMENTED');
  assert.equal(entry.preRunCleanup, false);
  assert.equal(entry.postRunCleanup, false);
  assert.equal(entry.verificationEvidence, null);
  assert.equal(formalCleanupSupportsCandidate(FORMAL_CLEANUP_SUPPORT, 'Trigger.dev'), false);
});
