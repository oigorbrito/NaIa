import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGoogleCalendarProvider } from '../../src/product/google-calendar.mjs';
import { createRuntimeComposition } from '../../src/product/runtime-config.mjs';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const apiBaseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ apiBaseUrl });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

test('GCAL-01 list request uses Google event query shape and normalizes items', async () => {
  let observed = null;
  await withServer((req, res) => {
    observed = { url: req.url, auth: req.headers.authorization };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items: [{
      id: 'g-1', summary: 'Planning', status: 'confirmed', htmlLink: 'https://calendar.google/event/g-1',
      start: { dateTime: '2026-09-11T13:00:00Z' }, end: { dateTime: '2026-09-11T14:00:00Z' },
    }] }));
  }, async ({ apiBaseUrl }) => {
    const provider = createGoogleCalendarProvider({ accessToken: 'secret-token', apiBaseUrl });
    const events = await provider.list({ from: '2026-09-11T00:00:00Z', to: '2026-09-12T00:00:00Z' });
    const url = new URL(observed.url, apiBaseUrl);

    assert.equal(url.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(url.searchParams.get('timeMin'), '2026-09-11T00:00:00Z');
    assert.equal(url.searchParams.get('timeMax'), '2026-09-12T00:00:00Z');
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('orderBy'), 'startTime');
    assert.equal(observed.auth, 'Bearer secret-token');
    assert.deepEqual(events, [{
      id: 'g-1', title: 'Planning', start: '2026-09-11T13:00:00Z', end: '2026-09-11T14:00:00Z',
      status: 'confirmed', htmlLink: 'https://calendar.google/event/g-1',
    }]);
  });
});

test('GCAL-02 create maps NaIA event fields to Google events.insert shape', async () => {
  let observed = null;
  await withServer(async (req, res) => {
    observed = { method: req.method, url: req.url, body: await readRequestJson(req) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'created', summary: observed.body.summary, start: observed.body.start, end: observed.body.end }));
  }, async ({ apiBaseUrl }) => {
    const provider = createGoogleCalendarProvider({ accessToken: 'token', apiBaseUrl, calendarId: 'primary' });
    const event = await provider.create({ start: '2026-09-11T13:00:00.000Z', end: '2026-09-11T14:00:00.000Z', title: 'Dentist' });

    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/calendar/v3/calendars/primary/events');
    assert.deepEqual(observed.body, {
      summary: 'Dentist',
      start: { dateTime: '2026-09-11T13:00:00.000Z' },
      end: { dateTime: '2026-09-11T14:00:00.000Z' },
    });
    assert.equal(event.id, 'created');
    assert.equal(event.title, 'Dentist');
  });
});

test('GCAL-03 update uses PATCH and encodes event identity', async () => {
  let observed = null;
  await withServer(async (req, res) => {
    observed = { method: req.method, url: req.url, body: await readRequestJson(req) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'evt/a b', summary: observed.body.summary, start: observed.body.start, end: observed.body.end }));
  }, async ({ apiBaseUrl }) => {
    const provider = createGoogleCalendarProvider({ accessToken: 'token', apiBaseUrl });
    await provider.update({ eventId: 'evt/a b', start: '2026-09-11T15:00:00.000Z', end: '2026-09-11T16:00:00.000Z', title: 'Review' });

    assert.equal(observed.method, 'PATCH');
    assert.equal(observed.url, '/calendar/v3/calendars/primary/events/evt%2Fa%20b');
    assert.equal(observed.body.summary, 'Review');
  });
});

test('GCAL-04 access token is required and provider output does not expose it', async () => {
  assert.throws(() => createGoogleCalendarProvider({ accessToken: '' }), /access token is required/i);
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"items":[]}');
  }, async ({ apiBaseUrl }) => {
    const secret = 'do-not-expose';
    const provider = createGoogleCalendarProvider({ accessToken: secret, apiBaseUrl });
    const result = await provider.list({ from: '2026-09-11T00:00:00Z', to: '2026-09-12T00:00:00Z' });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(provider), new RegExp(secret));
  });
});

test('GCAL-05 429 and 5xx are retryable while other 4xx are permanent', async () => {
  for (const [status, retryable] of [[429, true], [503, true], [401, false], [404, false]]) {
    await withServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{"error":"fixture"}');
    }, async ({ apiBaseUrl }) => {
      const provider = createGoogleCalendarProvider({ accessToken: 'token', apiBaseUrl });
      await assert.rejects(
        () => provider.list({ from: '2026-09-11T00:00:00Z', to: '2026-09-12T00:00:00Z' }),
        (error) => error.retryable === retryable && error.message.includes(String(status)),
      );
    });
  }
});

test('GCAL-06 timeout never becomes success', async () => {
  await withServer((req, res) => {
    setTimeout(() => {
      if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end('{"items":[]}');
    }, 150);
  }, async ({ apiBaseUrl }) => {
    const provider = createGoogleCalendarProvider({ accessToken: 'token', apiBaseUrl, timeoutMs: 25 });
    await assert.rejects(
      () => provider.list({ from: '2026-09-11T00:00:00Z', to: '2026-09-12T00:00:00Z' }),
      (error) => error.retryable === true && /timed out/i.test(error.message),
    );
  });
});

test('GCAL-07 runtime composition registers Google-backed calendar capabilities without exposing token metadata', () => {
  const secret = 'runtime-google-secret';
  const composition = createRuntimeComposition({ env: {
    NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN: secret,
    NAIA_GOOGLE_CALENDAR_ID: 'primary',
    NAIA_GOOGLE_CALENDAR_API_BASE_URL: 'https://www.googleapis.com',
  } });
  const metadata = JSON.stringify(composition.capabilities.list());
  assert.match(metadata, /calendar\.list/);
  assert.match(metadata, /calendar\.create/);
  assert.match(metadata, /calendar\.update/);
  assert.doesNotMatch(metadata, new RegExp(secret));
  assert.equal(composition.executionAdapters.length, 1);
});

test('GCAL-08 dual generic and Google calendar provider configuration fails closed', () => {
  assert.throws(
    () => createRuntimeComposition({ env: {
      NAIA_CALENDAR_BASE_URL: 'https://calendar-provider.example.test',
      NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN: 'token',
    } }),
    /multiple calendar providers configured/i,
  );
});
