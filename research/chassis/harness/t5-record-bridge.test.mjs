import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT5Control } from './t5-ownership-control.mjs';
import { controlResultToT5Evidence } from './t5-evaluator.mjs';
import { t5EvidenceToRunResult } from './t5-record-bridge.mjs';

const spec = { experimentId: 'temporal-typescript-t5-001' };
const setup = { adapterSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64) };

test('T5 bridge marks fenced two-worker ownership race as injected with all checks true', () => {
  const evidence = controlResultToT5Evidence(executeDeterministicT5Control({ unsafe: false }));
  const run = t5EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.intended, 'T5');
  assert.equal(run.fault.injected, true);
  assert.equal(run.fault.targetKind, 'concurrent-worker-ownership-race');
  assert.equal(run.fault.targetIdentity, 'control-worker-A');
  assert.equal(run.fault.durableAuthorityAlive, true);
  assert.equal(Object.values(run.acceptanceChecks).every(Boolean), true);
});

test('T5 bridge exposes transient stale authority as failed acceptance while fault remains injected', () => {
  const evidence = controlResultToT5Evidence(executeDeterministicT5Control({ unsafe: true }));
  const run = t5EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, true);
  assert.equal(run.acceptanceChecks.staleCompletionRejectedOrNonAuthoritative, false);
  assert.equal(run.acceptanceChecks.staleNeverBecameAuthoritative, false);
  assert.equal(run.acceptanceChecks.finalAuthorityIsNew, true);
});

test('T5 bridge refuses a stale attempt that happened only after B completion', () => {
  const evidence = controlResultToT5Evidence(executeDeterministicT5Control({ unsafe: false }));
  evidence.staleCompletion.attemptedBeforeNewCompletion = false;
  const run = t5EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, false);
  assert.equal(run.acceptanceChecks.staleAttemptBeforeNewCompletion, false);
});

test('T5 bridge refuses single-worker evidence as a completed fault injection', () => {
  const evidence = controlResultToT5Evidence(executeDeterministicT5Control({ unsafe: false }));
  evidence.newWorkerIdentity = evidence.oldWorkerIdentity;
  const run = t5EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, false);
  assert.equal(run.acceptanceChecks.workersDistinct, false);
});
