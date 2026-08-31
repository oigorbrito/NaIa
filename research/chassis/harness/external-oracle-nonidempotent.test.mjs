import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalEffectOracle } from './external-oracle.mjs';

async function post(baseUrl, operationId, { dropOnce = false, nonIdempotent = false } = {}) {
  return fetch(`${baseUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId,
      ...(dropOnce ? { 'x-drop-response-after-apply-once': '1' } : {}),
      ...(nonIdempotent ? { 'x-non-idempotent-provider': '1' } : {})
    },
    body: JSON.stringify({ objectiveId: 'objective-t15', operationId })
  });
}

async function state(baseUrl, operationId) {
  const response = await fetch(`${baseUrl}/operations/${encodeURIComponent(operationId)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('non-idempotent provider reapplies the same operation identity on every request', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());
  const operationId = 't15:non-idempotent';

  assert.equal((await post(baseUrl, operationId, { nonIdempotent: true })).status, 200);
  assert.equal((await post(baseUrl, operationId, { nonIdempotent: true })).status, 200);

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.providerMode, 'NON_IDEMPOTENT');
  assert.equal(observed.requestCount, 2);
  assert.equal(observed.applyCount, 2);
});

test('lost response plus blind retry duplicates a non-idempotent external effect', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());
  const operationId = 't15:lost-response';

  await assert.rejects(post(baseUrl, operationId, { dropOnce: true, nonIdempotent: true }));
  assert.equal((await post(baseUrl, operationId, { dropOnce: true, nonIdempotent: true })).status, 200);

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.requestCount, 2);
  assert.equal(observed.applyCount, 2);
  assert.equal(observed.responseLossCount, 1);
});

test('provider-mode drift for one semantic operation fails closed', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());
  const operationId = 't15:mode-drift';

  assert.equal((await post(baseUrl, operationId)).status, 200);
  const drift = await post(baseUrl, operationId, { nonIdempotent: true });
  assert.equal(drift.status, 409);

  const observed = await state(baseUrl, operationId);
  assert.equal(observed.providerMode, 'IDEMPOTENT_BY_OPERATION_ID');
  assert.equal(observed.applyCount, 1);
});
