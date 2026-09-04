import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBearerIngressAuthenticator, createHmacIngressAuthenticator, createTriggerIngress } from '../../src/product/trigger-ingress.mjs';
import { createDeadLetterStore, createRetryPolicy, createRetryingTriggerDispatcher } from '../../src/product/retry-policy.mjs';
import { createTriggerHttpServer } from '../../src/product/trigger-server.mjs';

test('bearer ingress rejects unauthorized requests and accepts authenticated delivery', async () => {
  const seen = [];
  const runtime = { async dispatch(delivery) { seen.push(delivery); return { deduplicated: false, run: { id: 'r1' } }; } };
  const ingress = createTriggerIngress({ runtime, authenticator: createBearerIngressAuthenticator({ token: 'secret' }) });
  const denied = await ingress.handle({ method: 'POST', headers: {}, body: { automationId: 'a1' } });
  assert.equal(denied.status, 401);
  const accepted = await ingress.handle({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { automationId: 'a1' } });
  assert.equal(accepted.status, 202);
  assert.equal(seen.length, 1);
});

test('hmac ingress validates raw body signature', async () => {
  const body = JSON.stringify({ automationId: 'a1' });
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', 'key').update(body).digest('hex');
  const runtime = { async dispatch() { return { deduplicated: true, run: { id: 'r1' } }; } };
  const ingress = createTriggerIngress({ runtime, authenticator: createHmacIngressAuthenticator({ secret: 'key' }) });
  const accepted = await ingress.handle({ method: 'POST', headers: { 'x-naia-signature': signature }, rawBody: body, body: JSON.parse(body) });
  assert.equal(accepted.status, 200);
});

test('retry dispatcher backs off retryable failures and succeeds without dead-letter', async () => {
  let calls = 0;
  const delays = [];
  const runtime = { async dispatch() { calls += 1; if (calls < 3) throw new Error('temporary'); return { deduplicated: false, run: { id: 'ok' } }; } };
  const deadLetters = createDeadLetterStore();
  const dispatcher = createRetryingTriggerDispatcher({
    runtime,
    retryPolicy: createRetryPolicy({ maxAttempts: 4, baseDelayMs: 10, multiplier: 2 }),
    deadLetters,
    sleep: async (ms) => { delays.push(ms); },
  });
  const result = await dispatcher.dispatch({ automationId: 'a1' });
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal((await dispatcher.deadLetters('a1')).length, 0);
});

test('retry dispatcher dead-letters terminal delivery', async () => {
  const deadLetters = createDeadLetterStore();
  const dispatcher = createRetryingTriggerDispatcher({
    runtime: { async dispatch() { throw new Error('boom'); } },
    retryPolicy: createRetryPolicy({ maxAttempts: 2, baseDelayMs: 1 }),
    deadLetters,
    sleep: async () => {},
  });
  await assert.rejects(() => dispatcher.dispatch({ automationId: 'a1', trigger: { kind: 'EVENT' } }), /dead-lettered after 2 attempt/);
  const rows = await dispatcher.deadLetters('a1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts, 2);
});

test('http trigger server exposes POST ingress endpoint', async () => {
  const ingress = createTriggerIngress({
    runtime: { async dispatch() { return { deduplicated: false, run: { id: 'r1' } }; } },
    authenticator: createBearerIngressAuthenticator({ token: 't' }),
  });
  const server = createTriggerHttpServer({ ingress, host: '127.0.0.1', port: 0 });
  const address = await server.start();
  const response = await fetch(`http://127.0.0.1:${address.port}/triggers`, {
    method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ automationId: 'a1' }),
  });
  assert.equal(response.status, 202);
  await server.stop();
});
