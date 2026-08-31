import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT16Control } from './t16-semantic-control.mjs';
import { t16EvidenceToRunResult } from './t16-record-bridge.mjs';

const spec = { experimentId: 'temporal-typescript-t16-001' };
const setup = { adapterSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64) };

test('T16 bridge marks controlled semantic mutation as injected and preserves validator-visible mutation evidence', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'REJECTED_INCOMPATIBLE' });
  const run = t16EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.intended, 'T16');
  assert.equal(run.fault.injected, true);
  assert.equal(run.fault.targetKind, 'semantic-profile-recovery');
  assert.equal(run.fault.targetIdentity, evidence.objectiveIdentity);
  assert.deepEqual(run.rawObservations.semanticMutation, evidence.semanticMutation);
  assert.equal(Object.values(run.acceptanceChecks).every(Boolean), true);
});

test('T16 bridge keeps injected=true when semantic mutation executes but silent reinterpretation fails acceptance', () => {
  const evidence = executeDeterministicT16Control({ disposition: 'SILENT_REINTERPRETATION' });
  const run = t16EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, true);
  assert.equal(run.acceptanceChecks.compatibilityDispositionSafeAndExplicit, false);
  assert.equal(run.acceptanceChecks.noSilentSemanticChange, false);
});

test('T16 bridge refuses fault injection when before and after are equal', () => {
  const evidence = executeDeterministicT16Control({ before: 'same', after: 'same' });
  const run = t16EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, false);
  assert.equal(run.acceptanceChecks.semanticMutationActuallyChanged, false);
});
