import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkEligible, validateCriticalEvidence } from './critical-evidence-validator.mjs';

const base = {
  candidate: 'Temporal TypeScript',
  profile: 'temporal-ts-restricted-v1',
  mutant: 'T12',
  mode: 'local-process',
  verdict: 'PASS',
  startedAt: '2026-08-31T00:00:00Z',
  finishedAt: '2026-08-31T00:00:01Z',
  runtimeIdentity: 'node22+temporal-sdk-1.23.0',
  sourceRef: 'temporalio/sdk-typescript v1.23.0',
  faultPrimitive: 'late stale completion after newer authority',
  durableAuthority: 'Temporal server/history',
  authorityUnderFault: 'newer activity task token',
  reproduction: { command: 'example', repetitions: 100 },
  checks: { staleRejected: true, terminalNotOverwritten: true },
  artifacts: ['evidence.json']
};

test('valid executed critical evidence can pass structural validation', () => {
  assert.deepEqual(validateCriticalEvidence(base), { valid: true, errors: [] });
});

test('PASS cannot be promoted from static claims without executed metadata', () => {
  const result = validateCriticalEvidence({
    candidate: 'DBOS TypeScript',
    profile: 'dbos-ts-v4.27',
    mutant: 'T12',
    verdict: 'PASS',
    checks: { upstreamSaysFencing: true }
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /runtimeIdentity/);
  assert.match(result.errors.join('\n'), /artifact/);
});

test('Trigger.dev T7 cannot count controller death as worker crash evidence', () => {
  const result = validateCriticalEvidence({
    ...base,
    candidate: 'Trigger.dev',
    profile: 'triggerdev-v4.5.15',
    mutant: 'T7',
    mode: 'managed-controller',
    workerKillEvidence: { target: 'controller adapter process', signal: 'SIGKILL' }
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /controller process/);
});

test('T16 PASS requires explicit semantic mutation and compatibility outcome', () => {
  const result = validateCriticalEvidence({ ...base, mutant: 'T16' });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /mutation metadata/);
  assert.match(result.errors.join('\n'), /semanticCompatibilityOutcome/);
});

test('benchmark remains ineligible while any critical mutant is blocked, inconclusive, unexecuted, or missing', () => {
  const candidates = ['Temporal TypeScript'];
  const records = ['T5', 'T7', 'T8', 'T11', 'T12', 'T16'].map((mutant) => ({
    candidate: 'Temporal TypeScript', mutant, verdict: mutant === 'T16' ? 'NOT_EXECUTED' : 'PASS'
  }));
  const result = benchmarkEligible(records, candidates);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.missing, [{ candidate: 'Temporal TypeScript', mutant: 'T16', verdict: 'NOT_EXECUTED' }]);
});
