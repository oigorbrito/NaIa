import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDeterministicT11Control } from './t11-cancel-retry-control.mjs';
import { t11EvidenceToRunResult } from './t11-record-bridge.mjs';

const spec = { experimentId: 'dbos-typescript-t11-001' };
const setup = { adapterSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64) };

test('T11 bridge marks complete safe control as injected with passing acceptance checks', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  const run = t11EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.intended, 'T11');
  assert.equal(run.fault.injected, true);
  assert.equal(run.fault.targetKind, 'cancelled-worker-process');
  assert.equal(run.fault.targetIdentity, evidence.oldWorkerIdentity);
  assert.equal(run.fault.durableAuthorityAlive, true);
  assert.equal(Object.values(run.acceptanceChecks).every(Boolean), true);
});

test('T11 bridge keeps fault injected when recovery violates cancellation but fails acceptance', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: true });
  const run = t11EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, true);
  assert.equal(run.acceptanceChecks.zeroAcceptedProgressAfterCancel, false);
  assert.equal(run.acceptanceChecks.finalCancellationAuthoritative, false);
});

test('T11 bridge refuses to call the fault injected without durable cancellation authority', () => {
  const { evidence } = executeDeterministicT11Control({ unsafe: false });
  evidence.cancelAuthority.durable = false;
  const run = t11EvidenceToRunResult(evidence, spec, setup);
  assert.equal(run.fault.injected, false);
  assert.equal(run.acceptanceChecks.cancelAuthorityDurable, false);
});
