import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedLifecycleExperimentId,
  formalCleanupSupportsCandidate,
  runtimeVerificationEvidenceValid
} from './formal-cleanup-support.mjs';
import { currentLifecycleQualificationSha256 } from './formal-lifecycle-qualification-provenance.mjs';

const CANDIDATE = 'Temporal TypeScript';
const REVISION = '1'.repeat(40);

function evidence(overrides = {}) {
  return {
    executionRef: `github-actions:run=123;job=temporal;sha=${REVISION}`,
    repositoryRevision: REVISION,
    experimentId: expectedLifecycleExperimentId(CANDIDATE),
    mutantId: 'T5',
    repetition: 1,
    recordSha256: 'a'.repeat(64),
    validatorSha256: 'b'.repeat(64),
    harnessSha256: 'c'.repeat(64),
    lifecycleQualificationSha256: currentLifecycleQualificationSha256(CANDIDATE),
    verifiedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function support(value) {
  return {
    [CANDIDATE]: {
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
  const value = evidence({
    executionRef: `github-actions:run=123;job=temporal;sha=${'2'.repeat(40)}`
  });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects abbreviated Git revision in execution ref', () => {
  const value = evidence({ executionRef: 'github-actions:run=123;job=temporal;sha=abc1234' });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects another candidate lifecycle experiment identity', () => {
  const value = evidence({ experimentId: 'dbos-typescript-t5-001' });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});

test('runtime verification evidence rejects stale lifecycle qualification hash', () => {
  const value = evidence({ lifecycleQualificationSha256: '0'.repeat(64) });
  assert.equal(runtimeVerificationEvidenceValid(value, CANDIDATE), false);
});
