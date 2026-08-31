import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT12Control } from './t12-stale-completion-control.mjs';
import { t12EvidenceToRunResult } from './t12-record-bridge.mjs';

const spec = { experimentId: 'temporal-typescript-t12-001' };
const setup = { adapterSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64) };

test('T12 bridge marks complete fenced control as injected with passing checks', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  const run = t12EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.intended, 'T12');
  assert.equal(run.fault.injected, true);
  assert.equal(run.fault.targetKind, 'stale-completion-authority');
  assert.equal(run.fault.targetIdentity, evidence.oldAuthorityIdentity);
  assert.equal(run.fault.durableAuthorityAlive, true);
  assert.equal(Object.values(run.acceptanceChecks).every(Boolean), true);
});

test('T12 bridge keeps fault injected when stale completion overwrites but fails acceptance', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: true });
  const run = t12EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, true);
  assert.equal(run.acceptanceChecks.staleCompletionNeverAuthoritative, false);
  assert.equal(run.acceptanceChecks.finalResultOriginIsNew, false);
});

test('T12 bridge refuses injected status if stale submission ordering is not proven', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  evidence.staleCompletion.attemptedAfterNewCommit = false;
  const run = t12EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, false);
  assert.equal(run.acceptanceChecks.staleCompletionAfterNewCommit, false);
});
