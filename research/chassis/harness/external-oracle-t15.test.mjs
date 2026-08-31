import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalEffectOracle } from './external-oracle.mjs';

async function apply(baseUrl, operationId, body, { nonIdempotent = true, dropOnce = false } = {}) {
  return fetch(`${baseUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId,
      ...(nonIdempotent ? { 'x-non-idempotent-provider': '1' } : {}),
      ...(dropOnce ? { 'x-drop-response-after-apply-once': '1' } : {})
    },
    body: JSON.stringify(body)
  });
}

async function state(baseUrl, operationId) {
  const response = await fetch(`${baseUrl}/operations/${encodeURIComponent(operationId)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('T15 safe reconciliation observes one non-idempotent apply after lost response without resubmitting', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  const operationId = 't15-safe-reconcile';
  await assert.rejects(apply(baseUrl, operationId, { objectiveId: 'objective-safe' }, { dropOnce: true }));

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.providerMode, 'NON_IDEMPOTENT');
  assert.equal(observed.requestCount, 1);
  assert.equal(observed.applyCount, 1);
  assert.equal(observed.responseLossCount, 1);
});

test('T15 blind retry duplicates a non-idempotent external effect', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  const operationId = 't15-blind-retry';
  await assert.rejects(apply(baseUrl, operationId, { objectiveId: 'objective-blind' }, { dropOnce: true }));
  const retry = await apply(baseUrl, operationId, { objectiveId: 'objective-blind' }, { dropOnce: true });
  assert.equal(retry.status, 200);

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.providerMode, 'NON_IDEMPOTENT');
  assert.equal(observed.requestCount, 2);
  assert.equal(observed.applyCount, 2);
  assert.equal(observed.responseLossCount, 1);
});

test('provider mode cannot drift for an existing semantic operation', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  const operationId = 't15-provider-mode-drift';
  const first = await apply(baseUrl, operationId, { objectiveId: 'objective-drift' }, { nonIdempotent: false });
  assert.equal(first.status, 200);

  const drift = await apply(baseUrl, operationId, { objectiveId: 'objective-drift' }, { nonIdempotent: true });
  assert.equal(drift.status, 409);
  const body = await drift.json();
  assert.equal(body.error, 'provider_mode_drift');

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.providerMode, 'IDEMPOTENT_BY_OPERATION_ID');
  assert.equal(observed.applyCount, 1);
});
