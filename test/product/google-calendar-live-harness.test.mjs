import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function runNode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test('LIVE-GCAL-01 live harness exercises full NaIA stack and reports PASS without token leakage', async () => {
  const token = 'fixture-live-token';
  let auth = null;
  let requestUrl = null;
  await withServer((req, res) => {
    auth = req.headers.authorization ?? null;
    requestUrl = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items: [{ id: 'evt-1', summary: 'Fixture event', start: { dateTime: '2026-09-11T10:00:00Z' }, end: { dateTime: '2026-09-11T11:00:00Z' } }] }));
  }, async (baseUrl) => {
    const child = await runNode(['experiments/google-calendar-live/run.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN: token,
        NAIA_GOOGLE_CALENDAR_API_BASE_URL: baseUrl,
        NAIA_GOOGLE_CALENDAR_ID: 'primary',
        NAIA_GOOGLE_CALENDAR_LIVE_FROM: '2026-09-11T00:00:00Z',
        NAIA_GOOGLE_CALENDAR_LIVE_TO: '2026-09-12T00:00:00Z',
      },
    });
    assert.equal(child.status, 0, child.stderr);
    const output = JSON.parse(child.stdout);
    assert.equal(output.status, 'PASS');
    assert.equal(output.gate, 'LIVE_GCAL_READ');
    assert.equal(output.eventCount, 1);
    assert.equal(auth, `Bearer ${token}`);
    assert.match(requestUrl, /timeMin=2026-09-11T00%3A00%3A00\.000Z/);
    assert.match(requestUrl, /timeMax=2026-09-12T00%3A00%3A00\.000Z/);
    assert.doesNotMatch(child.stdout, new RegExp(token));
    assert.doesNotMatch(child.stderr, new RegExp(token));
  });
});
