import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReverseGateway } from './reverse-gateway.mjs';
import { createBrowserUseDispatch } from './browser-dispatch.mjs';

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>NaIA Reverse Probe</title></head><body><h1>ok</h1></body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/probe`,
      });
    });
  });
}

test('LIVE-01 Browser Use performs a real read-only browser task through NaIA reverse gateway', { timeout: 90000 }, async (t) => {
  const { server, url } = await startFixtureServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const dispatch = createBrowserUseDispatch({ timeoutMs: 75000 });
  const gateway = createReverseGateway({ dispatch });

  const result = await gateway.execute({
    objective: { id: 'obj-live-browser', approvals: [] },
    proposal: {
      id: 'live-browser-extract',
      tool: 'browser.extract',
      input: { url, goal: 'read the document title' },
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output?.title, 'NaIA Reverse Probe');
});
