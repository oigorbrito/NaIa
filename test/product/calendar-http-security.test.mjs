import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCalendarHttpProvider } from '../../src/product/calendar-http.mjs';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ baseUrl });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('CAL-11 calendar provider rejects redirects without following them', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    res.writeHead(302, { location: '/other' });
    res.end();
  }, async ({ baseUrl }) => {
    const provider = createCalendarHttpProvider({ baseUrl });
    await assert.rejects(
      () => provider.list({ from: '2026-09-11T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z' }),
      (error) => error.retryable === false && /redirects are not allowed/i.test(error.message),
    );
    assert.equal(requests, 1);
  });
});

test('CAL-12 calendar provider enforces response cap while streaming', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('["');
    res.write('x'.repeat(32));
    res.end('"]');
  }, async ({ baseUrl }) => {
    const provider = createCalendarHttpProvider({ baseUrl, maxBytes: 8 });
    await assert.rejects(
      () => provider.list({ from: '2026-09-11T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z' }),
      (error) => error.retryable === false && /exceeds maxBytes/i.test(error.message),
    );
  });
});
