import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { signTriggerDelivery } from '../../src/product/trigger-runtime.mjs';
import { createGitHubWebhookServer } from '../../src/product/github-webhook-server.mjs';

async function withWebhook({ ports, secret = 'github-secret', eventType = 'push', intent = 'uppercase: provider event', maxBytes } = {}, fn) {
  const service = createNaiaService(ports ?? createInMemoryPorts());
  const webhook = createGitHubWebhookServer({
    service,
    secret,
    automationId: 'github-provider-event',
    eventType,
    intent,
    host: '127.0.0.1',
    port: 0,
    maxBytes,
  });
  const address = await webhook.start();
  const url = `http://127.0.0.1:${address.port}/webhook/github`;
  try {
    await fn({ service, url, secret });
  } finally {
    await webhook.stop();
  }
}

async function deliver(url, { secret, payload, deliveryId = 'delivery-1', eventType = 'push', signature } = {}) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature ?? signTriggerDelivery(secret, raw),
      'x-github-delivery': deliveryId,
      'x-github-event': eventType,
    },
    body: raw,
  });
}

test('PROVIDER-EVENT-01 valid GitHub webhook creates a confirmable objective', async () => {
  await withWebhook({}, async ({ service, url, secret }) => {
    const response = await deliver(url, { secret, payload: { ref: 'refs/heads/main' } });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'WAITING_CONFIRMATION');

    const completed = await service.confirm(body.objectiveId);
    assert.equal(completed.objective.status, 'COMPLETED');
  });
});

test('PROVIDER-EVENT-02 replay with same GitHub delivery id deduplicates objective', async () => {
  const ports = createInMemoryPorts();
  await withWebhook({ ports }, async ({ service, url, secret }) => {
    const payload = { ref: 'refs/heads/main' };
    const first = await deliver(url, { secret, payload, deliveryId: 'same-delivery' });
    const second = await deliver(url, { secret, payload, deliveryId: 'same-delivery' });
    const a = await first.json();
    const b = await second.json();
    assert.equal(a.objectiveId, b.objectiveId);
    assert.equal((await service.history()).length, 1);
  });
});

test('PROVIDER-EVENT-03 invalid GitHub signature is rejected without side effects', async () => {
  const ports = createInMemoryPorts();
  await withWebhook({ ports }, async ({ service, url, secret }) => {
    const response = await deliver(url, { secret, payload: { ref: 'main' }, signature: 'sha256=invalid' });
    assert.equal(response.status, 401);
    assert.equal((await service.history()).length, 0);
  });
});

test('PROVIDER-EVENT-04 unexpected GitHub event type is rejected without side effects', async () => {
  const ports = createInMemoryPorts();
  await withWebhook({ ports, eventType: 'push' }, async ({ service, url, secret }) => {
    const response = await deliver(url, { secret, payload: { action: 'opened' }, eventType: 'issues' });
    assert.equal(response.status, 422);
    assert.equal((await service.history()).length, 0);
  });
});

test('PROVIDER-EVENT-05 oversized webhook body fails closed before objective creation', async () => {
  const ports = createInMemoryPorts();
  await withWebhook({ ports, maxBytes: 16 }, async ({ service, url, secret }) => {
    const response = await deliver(url, { secret, payload: JSON.stringify({ data: 'x'.repeat(100) }) });
    assert.equal(response.status, 413);
    assert.equal((await service.history()).length, 0);
  });
});

test('PROVIDER-EVENT-06 webhook secret never appears in file-backed persistence', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-provider-event-'));
  const secret = 'provider-event-super-secret';
  try {
    const ports = createFilePorts({ rootDir });
    await withWebhook({ ports, secret }, async ({ url }) => {
      const response = await deliver(url, { secret, payload: { ref: 'refs/heads/main' } });
      assert.equal(response.status, 202);
    });

    const stored = [
      await readFile(join(rootDir, 'objectives.json'), 'utf8'),
      await readFile(join(rootDir, 'plans.json'), 'utf8'),
      await readFile(join(rootDir, 'evidence.jsonl'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(stored, new RegExp(secret));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
