import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT5Control } from './t5-ownership-control.mjs';
import { controlResultToT5Evidence, evaluateT5Evidence } from './t5-evaluator.mjs';

test('T5 evaluator accepts fenced positive control', () => {
  const control = executeDeterministicT5Control({ unsafe: false });
  const evaluated = evaluateT5Evidence(controlResultToT5Evidence(control));
  assert.equal(evaluated.verdict, 'PASS');
  assert.equal(Object.values(evaluated.checks).every(Boolean), true);
});

test('T5 evaluator rejects unfenced stale overwrite control', () => {
  const control = executeDeterministicT5Control({ unsafe: true });
  const evidence = controlResultToT5Evidence(control);
  const evaluated = evaluateT5Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.staleCompletionRejectedOrNonAuthoritative, false);
  assert.equal(evaluated.checks.finalAuthorityIsNew, false);
  assert.equal(evaluated.checks.finalResultOriginIsNew, false);
});

test('T5 evaluator rejects single-worker evidence even when authority tokens differ', () => {
  const control = executeDeterministicT5Control({ unsafe: false });
  const evidence = controlResultToT5Evidence(control);
  evidence.oldWorkerIdentity = 'same-worker';
  evidence.newWorkerIdentity = 'same-worker';
  const evaluated = evaluateT5Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.workersDistinct, false);
});

test('T5 evaluator fails closed when worker identity is unavailable', () => {
  const control = executeDeterministicT5Control({ unsafe: false });
  const evidence = controlResultToT5Evidence(control);
  evidence.oldWorkerIdentity = null;
  const evaluated = evaluateT5Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.oldWorkerConcrete, false);
  assert.equal(evaluated.checks.workersDistinct, false);
});

test('T5 evaluator fails closed when authority identity is not concrete', () => {
  const control = executeDeterministicT5Control({ unsafe: false });
  const evidence = controlResultToT5Evidence(control);
  evidence.oldAuthorityIdentity = null;
  const evaluated = evaluateT5Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.oldAuthorityConcrete, false);
  assert.equal(evaluated.checks.authoritiesDistinct, false);
});

test('T5 evaluator fails closed when deterministic schedule is not proven', () => {
  const control = executeDeterministicT5Control({ unsafe: false });
  const evidence = controlResultToT5Evidence(control);
  evidence.deterministicScheduleObserved = false;
  const evaluated = evaluateT5Evidence(evidence);
  assert.equal(evaluated.verdict, 'FAIL');
  assert.equal(evaluated.checks.deterministicScheduleObserved, false);
});
