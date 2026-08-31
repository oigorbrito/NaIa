import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT16Control } from './t16-semantic-control.mjs';
import { evaluateT16Evidence } from './t16-evaluator.mjs';

test('T16 evaluator accepts explicit incompatibility rejection', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'REJECTED_INCOMPATIBLE' });
  const result = evaluateT16Evidence(evidence);
  assert.equal(result.verdict, 'PASS');
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('T16 evaluator accepts explicit compatible routing', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'ROUTED_TO_COMPATIBLE' });
  const result = evaluateT16Evidence(evidence);
  assert.equal(result.verdict, 'PASS');
});

test('T16 evaluator accepts explicit migration only with concrete migration identity', () => {
  const good = executeDeterministicT16Control({ disposition: 'EXPLICIT_MIGRATION', migrationIdentity: 'migration-v1-to-v2' });
  assert.equal(evaluateT16Evidence(good).verdict, 'PASS');

  const bad = executeDeterministicT16Control({ disposition: 'EXPLICIT_MIGRATION', migrationIdentity: null });
  const result = evaluateT16Evidence(bad);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.explicitMigrationIdentifiedWhenUsed, false);
});

test('T16 evaluator rejects silent semantic reinterpretation', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'SILENT_REINTERPRETATION' });
  const result = evaluateT16Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.compatibilityDispositionSafeAndExplicit, false);
  assert.equal(result.checks.noSilentSemanticChange, false);
  assert.equal(result.checks.priorMeaningPreservedOrExplicitlyMigrated, false);
});

test('T16 evaluator fails closed when before and after are equal', () => {
  const evidence = executeDeterministicT16Control({ before: 'same', after: 'same' });
  const result = evaluateT16Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.semanticMutationActuallyChanged, false);
});

test('T16 evaluator fails closed when compatibility disposition is unknown', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'UNKNOWN' });
  const result = evaluateT16Evidence(evidence);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.compatibilityDispositionSafeAndExplicit, false);
});
