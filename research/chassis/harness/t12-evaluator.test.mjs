import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT12Control } from './t12-stale-completion-control.mjs';
import { evaluateT12Evidence } from './t12-evaluator.mjs';

test('T12 evaluator accepts fenced positive control', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  const evaluated = evaluateT12Evidence(evidence);
  assert.equal(evaluated.verdict, 'PASS');
  assert.equal(Object.values(evaluated.checks).every(Boolean), true);
});

test('T12 evaluator rejects stale overwrite negative control', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: true });
  const evaluated = evaluateT12Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.staleCompletionRejectedOrNonAuthoritative, false);
  assert.equal(evaluated.checks.staleCompletionNeverAuthoritative, false);
  assert.equal(evaluated.checks.finalAuthorityIsNew, false);
});

test('T12 evaluator fails closed if stale submission was not proven after the new commit', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  evidence.staleCompletion.attemptedAfterNewCommit = false;
  const evaluated = evaluateT12Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.staleCompletionAfterNewCommit, false);
});

test('T12 evaluator fails closed without concrete distinct authority identities', () => {
  const { evidence } = executeDeterministicT12Control({ unsafe: false });
  evidence.newAuthorityIdentity = evidence.oldAuthorityIdentity;
  const evaluated = evaluateT12Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.authoritiesDistinct, false);
});
