import assert from 'node:assert/strict';
import test from 'node:test';

import { createExternalEffectOracle } from './external-oracle.mjs';

async function post(baseUrl, operationId, body, dropResponse = false) {
  return fetch(`${baseUrl}/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operation-id': operationId,
      ...(dropResponse ? { 'x-drop-response-after-apply': '1' } : {})
    },
    body: JSON.stringify(body)
  });
}

async function readOperation(baseUrl, operationId) {
  const response = await fetch(`${baseUrl}/operations/${encodeURIComponent(operationId)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('same operation id is applied exactly once while requests are counted', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  const first = await post(baseUrl, 'mission-1:step-B', { amount: 10 });
  assert.equal(first.status, 200);

  const second = await post(baseUrl, 'mission-1:step-B', { amount: 10 });
  assert.equal(second.status, 200);

  const state = await readOperation(baseUrl, 'mission-1:step-B');
  assert.equal(state.requestCount, 2);
  assert.equal(state.applyCount, 1);
  assert.equal(state.payload, JSON.stringify({ amount: 10 }));
});

test('different operation ids represent different external effects', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  await post(baseUrl, 'mission-2:step-B:1', { value: 'a' });
  await post(baseUrl, 'mission-2:step-B:2', { value: 'b' });

  assert.equal((await readOperation(baseUrl, 'mission-2:step-B:1')).applyCount, 1);
  assert.equal((await readOperation(baseUrl, 'mission-2:step-B:2')).applyCount, 1);
});

test('response can be lost after apply and reconciliation still proves effect happened', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  await assert.rejects(
    post(baseUrl, 'mission-3:step-B', { reservation: 'A' }, true)
  );

  const afterLoss = await readOperation(baseUrl, 'mission-3:step-B');
  assert.equal(afterLoss.requestCount, 1);
  assert.equal(afterLoss.applyCount, 1);

  const retry = await post(baseUrl, 'mission-3:step-B', { reservation: 'A' });
  assert.equal(retry.status, 200);

  const reconciled = await readOperation(baseUrl, 'mission-3:step-B');
  assert.equal(reconciled.requestCount, 2);
  assert.equal(reconciled.applyCount, 1);
});

test('missing operation id fails closed', async (t) => {
  const oracle = createExternalEffectOracle();
  const baseUrl = await oracle.start();
  t.after(() => oracle.stop());

  const response = await fetch(`${baseUrl}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unsafe: true })
  });

  assert.equal(response.status, 400);
});
