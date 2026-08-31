import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT12Control } from './t12-stale-completion-control.mjs';

test('T12 fenced control preserves newer authoritative completion', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  assert.equal(evidence.authorityAdvanced, true);
  assert.equal(evidence.newAuthorityCompletion.acceptedOrAuthoritative, true);
  assert.equal(evidence.staleCompletion.attemptedAfterNewCommit, true);
  assert.equal(evidence.staleCompletion.rejectedOrNonAuthoritative, true);
  assert.equal(evidence.staleCompletion.becameAuthoritative, false);
  assert.equal(evidence.finalResultOrigin, 'new-authority');
});

test('T12 unfenced negative control exposes late stale overwrite', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: true });
  assert.equal(evidence.newAuthorityCompletion.acceptedOrAuthoritative, true);
  assert.equal(evidence.staleCompletion.attemptedAfterNewCommit, true);
  assert.equal(evidence.staleCompletion.becameAuthoritative, true);
  assert.equal(evidence.staleCompletion.rejectedOrNonAuthoritative, false);
  assert.equal(evidence.finalResultOrigin, 'old-authority');
});

test('T12 control remains discriminating for 100 deterministic repetitions', () => {
  for (let repetition = 1; repetition <= 100; repetition += 1) {
    const safe = executeDeterministicT12Control({ unsafe: false, objectiveId: `t12-safe-${repetition}` }).evidence;
    const unsafe = executeDeterministicT12Control({ unsafe: true, objectiveId: `t12-unsafe-${repetition}` }).evidence;
    assert.equal(safe.staleCompletion.becameAuthoritative, false, `safe repetition ${repetition}`);
    assert.equal(safe.finalResultOrigin, 'new-authority', `safe repetition ${repetition}`);
    assert.equal(unsafe.staleCompletion.becameAuthoritative, true, `unsafe repetition ${repetition}`);
    assert.equal(unsafe.finalResultOrigin, 'old-authority', `unsafe repetition ${repetition}`);
  }
});
