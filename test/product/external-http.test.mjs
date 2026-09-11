import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCapabilityRegistry, createDefaultCapabilityRegistry } from '../../src/product/capabilities.mjs';
import { createHttpReadAdapter, createHttpReadCapability } from '../../src/product/http-read.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ server, baseUrl });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function createHttpNaia(baseUrl, options = {}) {
  const capabilities = createCapabilityRegistry([
    ...createDefaultCapabilityRegistry().list().map((entry) => {
      throw new Error(`unexpected metadata-only capability in test setup: ${entry.id}`);
    }),
  ]);
  return { capabilities };
}

function buildPorts(baseUrl, adapterOptions = {}) {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(createHttpReadCapability({ prefix: 'provider-read' }));
  const adapter = createHttpReadAdapter({ baseUrl, ...adapterOptions });
  return createInMemoryPorts({ capabilities, executionAdapters: [adapter] });
}

test('EXT-HTTP-01 configured-origin read executes and is evidenced through NaIA service', async () => {
  await withServer((req, res) => {
    if (req.url === '/profile') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"name":"NaIA"}');
      return;
    }
    res.writeHead(404).end();
  }, async ({ baseUrl }) => {
    const ports = buildPorts(baseUrl);
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'provider-read /profile' });

    assert.equal(result.objective.status, 'COMPLETED');
    assert.equal(result.plan.capabilityId, 'http.read');
    assert.equal(result.plan.steps[1].action.tool, 'http.read');

    const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
    const executed = evidence.find((entry) => entry.type === 'STEP_EXECUTED' && entry.tool === 'http.read');
    assert.equal(executed.ok, true);
    assert.equal(executed.output.result.status, 200);
    assert.equal(executed.output.result.body, '{"name":"NaIA"}');
    assert.equal(executed.output.result.path, '/profile');
  });
});

test('EXT-HTTP-02 malformed or absolute target fails closed before request', async () => {
  let calls = 0;
  await withServer((req, res) => {
    calls += 1;
    res.writeHead(200).end('unexpected');
  }, async ({ baseUrl }) => {
    const ports = buildPorts(baseUrl);
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'provider-read https://example.com/escape' });

    assert.equal(result.objective.status, 'FAILED');
    assert.equal(result.objective.retryDisposition, 'PERMANENT');
    assert.equal(calls, 0);
  });
});

test('EXT-HTTP-03 redirect cannot escape configured origin', async () => {
  await withServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://example.com/escape' }).end();
      return;
    }
    res.writeHead(200).end('ok');
  }, async ({ baseUrl }) => {
    const ports = buildPorts(baseUrl);
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'provider-read /redirect' });

    assert.equal(result.objective.status, 'FAILED');
    assert.equal(result.objective.retryDisposition, 'PERMANENT');
    assert.match(result.objective.lastError, /redirect escaped configured origin/i);
  });
});

test('EXT-HTTP-04 body limit fails closed', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('0123456789');
  }, async ({ baseUrl }) => {
    const ports = buildPorts(baseUrl, { maxBytes: 4 });
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'provider-read /large' });

    assert.equal(result.objective.status, 'FAILED');
    assert.equal(result.objective.retryDisposition, 'PERMANENT');
    assert.match(result.objective.lastError, /exceeds maxBytes/i);
  });
});

test('EXT-HTTP-05 timeout is retryable and never success', async () => {
  await withServer((req, res) => {
    setTimeout(() => {
      if (!res.writableEnded) res.writeHead(200).end('late');
    }, 150);
  }, async ({ baseUrl }) => {
    const ports = buildPorts(baseUrl, { timeoutMs: 30 });
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'provider-read /slow' });

    assert.equal(result.objective.status, 'FAILED');
    assert.equal(result.objective.retryDisposition, 'TRANSIENT');
    assert.match(result.objective.lastError, /timed out/i);
  });
});

test('EXT-HTTP-06 unsupported base scheme and embedded credentials fail at construction', () => {
  assert.throws(() => createHttpReadAdapter({ baseUrl: 'file:///tmp/data' }), /unsupported .* scheme/i);
  assert.throws(() => createHttpReadAdapter({ baseUrl: 'https://user:secret@example.com' }), /must not contain credentials/i);
});

test('EXT-HTTP-07 capability is opt-in and default registry behavior is unchanged', () => {
  const defaults = createDefaultCapabilityRegistry();
  assert.equal(defaults.resolve('provider-read /profile'), null);

  defaults.register(createHttpReadCapability({ prefix: 'provider-read' }));
  const resolved = defaults.resolve('provider-read /profile');
  assert.equal(resolved.capabilityId, 'http.read');
  assert.deepEqual(resolved.action, {
    tool: 'http.read',
    input: { path: '/profile' },
    risk: 'READ_ONLY',
    requiresApproval: false,
  });
});
