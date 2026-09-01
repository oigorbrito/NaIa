import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runIsolatedExternalFault } from './isolated-external-fault-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, 'fixtures', 'contract-adapter-control.mjs');

test('T7 uses a dedicated pre-checkpoint SIGKILL without response loss and delegates semantic acceptance', async () => {
  const result = await runIsolatedExternalFault({
    adapter,
    candidate: 'control-stable',
    cwd: path.dirname(adapter),
    mutantId: 'T7',
    timeoutMs: 1500
  });

  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.signal, 'SIGKILL');
  assert.equal(Number.isInteger(result.fault.targetIdentity), true);
  assert.equal(result.rawObservations.totalResponseLossCount, 0);
  assert.equal(result.rawObservations.totalApplyCount, 1);
  assert.equal(result.rawObservations.semanticEvaluationValid, true);
  assert.equal('crashInjected' in result.acceptanceChecks, false);
  assert.equal(result.acceptanceChecks.responseLossNotInjected, true);
  assert.equal(result.acceptanceChecks.exactlyOneExternalApply, true);
});

test('T8 never uses restart to rescue a timed-out response-loss repetition', async () => {
  const result = await runIsolatedExternalFault({
    adapter,
    candidate: 'control-stable',
    cwd: path.dirname(adapter),
    mutantId: 'T8',
    timeoutMs: 250
  });

  assert.equal(result.fault.injected, true);
  assert.equal(result.rawObservations.totalResponseLossCount, 1);
  assert.equal(result.rawObservations.resume, null);
  assert.equal(result.rawObservations.measurementCutoffKilledProcess, true);
  assert.equal(result.rawObservations.semanticEvaluationValid, true);
  assert.equal(result.acceptanceChecks.measurementCutoffNotReached, false);
  assert.equal('exactlyOneResponseLoss' in result.acceptanceChecks, false);
});
