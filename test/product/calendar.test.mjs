import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDefaultCapabilityRegistry } from '../../src/product/capabilities.mjs';
import { createCalendarCapabilities, createCalendarExecutionAdapter } from '../../src/product/calendar.mjs';
import { createCalendarHttpProvider } from '../../src/product/calendar-http.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createRuntimeComposition } from '../../src/product/runtime-config.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

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

function fixtureCalendar({ onList, onCreate, onUpdate } = {}) {
  const calls = [];
  const provider = {
    async list(input) { calls.push({ method: 'list', input }); return onList ? onList(input) : []; },
    async create(input) { calls.push({ method: 'create', input }); return onCreate ? onCreate(input) : { id: 'created-1', ...input }; },
    async update(input) { calls.push({ method: 'update', input }); return onUpdate ? onUpdate(input) : { ...input }; },
  };
  return { provider, calls };
}

function calendarPorts(provider) {
  const capabilities = createDefaultCapabilityRegistry();
  for (const capability of createCalendarCapabilities()) capabilities.register(capability);
  return createInMemoryPorts({
    capabilities,
    executionAdapters: [createCalendarExecutionAdapter({ provider })],
  });
}

test('CAL-01 list is read-only and completes without approval', async () => {
  const { provider, calls } = fixtureCalendar({ onList: () => [{ id: 'evt-1', title: 'Daily' }] });
  const ports = calendarPorts(provider);
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title: 'calendar list 2026-09-11T00:00:00Z | 2026-09-12T00:00:00Z' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.plan.capabilityId, 'calendar.list');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'list');
  assert.deepEqual(calls[0].input, {
    from: '2026-09-11T00:00:00.000Z',
    to: '2026-09-12T00:00:00.000Z',
  });
  assert.equal(result.plan.steps[1].action.requiresApproval, false);
});

test('CAL-02 create stops before provider dispatch', async () => {
  const { provider, calls } = fixtureCalendar();
  const ports = calendarPorts(provider);
  const naia = createNaiaService(ports);
  const pending = await naia.pursue({ title: 'calendar create 2026-09-11T13:00:00Z | 2026-09-11T14:00:00Z | Dentist' });

  assert.equal(pending.objective.status, 'WAITING_APPROVAL');
  assert.equal(calls.length, 0);
  assert.equal(pending.authorization.scope, 'calendar:create');
});

test('CAL-03 correct create approval dispatches exactly once', async () => {
  const { provider, calls } = fixtureCalendar();
  const ports = calendarPorts(provider);
  const naia = createNaiaService(ports);
  const pending = await naia.pursue({ title: 'calendar create 2026-09-11T13:00:00Z | 2026-09-11T14:00:00Z | Dentist' });
  const completed = await naia.approve(pending.objective.id, 'calendar.create', 'calendar:create');

  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'create');
  assert.equal(calls[0].input.title, 'Dentist');
});

test('CAL-04 update approval is event-scoped and does not transfer', async () => {
  const { provider, calls } = fixtureCalendar();
  const ports = calendarPorts(provider);
  const naia = createNaiaService(ports);
  const pending = await naia.pursue({ title: 'calendar update evt-42 | 2026-09-11T15:00:00Z | 2026-09-11T16:00:00Z | Review' });

  await assert.rejects(
    () => naia.approve(pending.objective.id, 'calendar.update', 'calendar:update:evt-99'),
    /approval scope mismatch/i,
  );
  assert.equal(calls.length, 0);

  const completed = await naia.approve(pending.objective.id, 'calendar.update', 'calendar:update:evt-42');
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.eventId, 'evt-42');
});

test('CAL-05 malformed date range fails before provider dispatch', async () => {
  const { provider, calls } = fixtureCalendar();
  const ports = calendarPorts(provider);
  const naia = createNaiaService(ports);

  await assert.rejects(
    () => naia.pursue({ title: 'calendar create 2026-09-11T15:00:00Z | 2026-09-11T14:00:00Z | Invalid' }),
    (error) => error.code === 'INVALID_CALENDAR_INPUT',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(await ports.objectives.list(), []);
});

test('CAL-06 provider token is used at transport but never persisted or evidenced', async () => {
  const secret = 'calendar-super-secret';
  let authorization = null;
  await withServer((req, res) => {
    authorization = req.headers.authorization ?? null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  }, async ({ baseUrl }) => {
    const composition = createRuntimeComposition({ env: {
      NAIA_CALENDAR_BASE_URL: baseUrl,
      NAIA_CALENDAR_TOKEN: secret,
    } });
    const ports = createInMemoryPorts(composition);
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'calendar list 2026-09-11T00:00:00Z | 2026-09-12T00:00:00Z' });

    assert.equal(result.objective.status, 'COMPLETED');
    assert.equal(authorization, `Bearer ${secret}`);
    const snapshot = JSON.stringify({
      objectives: await ports.objectives.list(),
      evidence: await ports.evidence.list(),
      plan: result.plan,
    });
    assert.doesNotMatch(snapshot, new RegExp(secret));
  });
});

test('CAL-07 HTTP 5xx is retryable and 4xx is permanent', async () => {
  for (const [status, disposition] of [[503, 'TRANSIENT'], [403, 'PERMANENT']]) {
    await withServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{"error":"fixture"}');
    }, async ({ baseUrl }) => {
      const provider = createCalendarHttpProvider({ baseUrl });
      const ports = calendarPorts(provider);
      const naia = createNaiaService(ports);
      const result = await naia.pursue({ title: 'calendar list 2026-09-11T00:00:00Z | 2026-09-12T00:00:00Z' });
      assert.equal(result.objective.status, 'FAILED');
      assert.equal(result.objective.retryDisposition, disposition);
    });
  }
});

test('CAL-08 timeout never becomes success', async () => {
  await withServer((req, res) => {
    setTimeout(() => {
      if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    }, 150);
  }, async ({ baseUrl }) => {
    const provider = createCalendarHttpProvider({ baseUrl, timeoutMs: 25 });
    const ports = calendarPorts(provider);
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'calendar list 2026-09-11T00:00:00Z | 2026-09-12T00:00:00Z' });

    assert.equal(result.objective.status, 'FAILED');
    assert.equal(result.objective.retryDisposition, 'TRANSIENT');
    assert.match(result.objective.lastError, /timed out/i);
  });
});

test('CAL-09 default runtime remains unchanged when calendar configuration is absent', () => {
  const composition = createRuntimeComposition({ env: {} });
  const ids = composition.capabilities.list().map((item) => item.id);
  assert.equal(ids.includes('calendar.list'), false);
  assert.equal(ids.includes('calendar.create'), false);
  assert.equal(ids.includes('calendar.update'), false);
});

test('CAL-10 configured runtime exposes calendar capabilities without token metadata', () => {
  const secret = 'metadata-secret';
  const composition = createRuntimeComposition({ env: {
    NAIA_CALENDAR_BASE_URL: 'https://calendar.example.test',
    NAIA_CALENDAR_TOKEN: secret,
  } });
  const metadata = JSON.stringify(composition.capabilities.list());
  assert.match(metadata, /calendar\.list/);
  assert.match(metadata, /calendar\.create/);
  assert.match(metadata, /calendar\.update/);
  assert.doesNotMatch(metadata, new RegExp(secret));
});
