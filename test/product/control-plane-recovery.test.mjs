import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderSubscriptionStatus,
  createProviderSubscriptionStore,
  createProviderSubscriptionManager,
  createProviderSubscriptionAdapter,
  createGitHubWebhookSubscriptionAdapter,
} from '../../src/product/provider-subscriptions.mjs';
import { createControlPlaneOperations } from '../../src/product/control-plane-operations.mjs';
import { createControlPlaneJournal } from '../../src/product/control-plane-journal.mjs';
import {
  RemoteSubscriptionState,
  SubscriptionDriftKind,
  createRemoteSubscriptionProbe,
  createRemoteSubscriptionProbeRegistry,
  createSubscriptionReconciler,
  createGitHubWebhookRemoteProbe,
} from '../../src/product/remote-state-reconciliation.mjs';

function adapter(provider, calls = []) {
  return createProviderSubscriptionAdapter({
    provider,
    async create(input) { calls.push(['create', input.automationId]); return { externalId: `ext-${input.automationId}`, expiresAt: '2026-09-25T00:00:00Z' }; },
    async renew(input) { calls.push(['renew', input.automationId]); return { externalId: input.externalId, expiresAt: '2026-09-26T00:00:00Z' }; },
    async stop(input) { calls.push(['stop', input.externalId ?? input.automationId]); return true; },
  });
}

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, async text() { return body == null ? '' : JSON.stringify(body); } };
}

test('provider subscription lifecycle is idempotent and renewable', async () => {
  const calls = [];
  const manager = createProviderSubscriptionManager({ store: createProviderSubscriptionStore(), adapters: [adapter('github', calls)] });
  const first = await manager.ensure({ provider: 'github', automationId: 'a1', callbackUrl: 'https://naia.test/hook' });
  const second = await manager.ensure({ provider: 'github', automationId: 'a1', callbackUrl: 'https://naia.test/hook' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  const renewed = await manager.renew(first.subscription.id);
  assert.equal(renewed.status, ProviderSubscriptionStatus.ACTIVE);
  assert.equal(renewed.expiresAt, '2026-09-26T00:00:00Z');
  const stopped = await manager.stop(first.subscription.id);
  assert.equal(stopped.status, ProviderSubscriptionStatus.STOPPED);
});

test('control plane maintenance renews expiring subscriptions and journals the run', async () => {
  const calls = [];
  const store = createProviderSubscriptionStore([{ id: 'soon', provider: 'gmail', automationId: 'a', status: 'ACTIVE', expiresAt: '2026-09-23T22:30:00Z' }]);
  const manager = createProviderSubscriptionManager({ store, adapters: [adapter('gmail', calls)] });
  const journal = createControlPlaneJournal();
  const ops = createControlPlaneOperations({
    subscriptions: manager,
    schedulerBridge: { async sync() { return { registered: 1, active: [{ automationId: 'a' }] }; } },
    journal,
    renewalWindowMs: 3 * 60 * 60 * 1000,
    now: () => Date.parse('2026-09-23T21:00:00Z'),
  });
  const entry = await ops.runMaintenance();
  assert.equal(entry.ok, true);
  assert.equal(entry.renewal.renewed.length, 1);
  assert.equal(calls.some(([kind]) => kind === 'renew'), true);
  assert.equal((await ops.history()).length, 1);
});

test('missing remote subscription is actionable and repaired through recreate', async () => {
  const calls = [];
  const store = createProviderSubscriptionStore([{ id: 's1', provider: 'github', automationId: 'a1', externalId: 'old', status: 'ACTIVE', callbackUrl: 'https://naia.test/hook', metadata: { repository: 'oigorbrito/NaIa' } }]);
  const manager = createProviderSubscriptionManager({
    store,
    adapters: [createGitHubWebhookSubscriptionAdapter({
      async create(input) { calls.push(['create', input.automationId]); return { externalId: 'new', metadata: { repository: 'oigorbrito/NaIa' } }; },
      async renew() { throw new Error('not used'); },
      async stop(subscription) { calls.push(['stop', subscription.externalId]); return true; },
    })],
  });
  const probes = createRemoteSubscriptionProbeRegistry([createRemoteSubscriptionProbe({ provider: 'github', async inspect() { return { state: RemoteSubscriptionState.MISSING }; } })]);
  const reconciler = createSubscriptionReconciler({ subscriptions: manager, probes });
  const report = await reconciler.reconcile();
  assert.equal(report.healthy, false);
  assert.equal(report.actionable[0].kind, SubscriptionDriftKind.MISSING_REMOTE);
  const repaired = await reconciler.repair(report);
  assert.equal(repaired.failed.length, 0);
  assert.deepEqual(calls, [['stop', 'old'], ['create', 'a1']]);
  assert.equal((await manager.get('s1')).externalId, 'new');
});

test('remote callback drift is detected without automatic false PASS', async () => {
  const manager = {
    async list() { return [{ id: 's3', provider: 'github', automationId: 'a3', externalId: '3', status: 'ACTIVE', callbackUrl: 'https://local.test' }]; },
    async recreate() {}, async stop() {},
  };
  const probes = createRemoteSubscriptionProbeRegistry([createRemoteSubscriptionProbe({ provider: 'github', async inspect() { return { state: 'PRESENT', externalId: '3', callbackUrl: 'https://remote.test' }; } })]);
  const report = await createSubscriptionReconciler({ subscriptions: manager, probes }).reconcile();
  assert.equal(report.actionable[0].kind, SubscriptionDriftKind.CALLBACK_DRIFT);
});

test('github webhook remote probe maps 404 to missing and reads present identity', async () => {
  let mode = 'missing';
  const probe = createGitHubWebhookRemoteProbe({
    token: 'token',
    fetchImpl: async () => mode === 'missing' ? response(404, { message: 'Not Found' }) : response(200, { id: 77, active: true, events: ['issues'], config: { url: 'https://naia.test/hook' } }),
  });
  const subscription = { provider: 'github', externalId: '77', callbackUrl: 'https://naia.test/hook', metadata: { repository: 'oigorbrito/NaIa' } };
  assert.equal((await probe.inspect(subscription)).state, RemoteSubscriptionState.MISSING);
  mode = 'present';
  const present = await probe.inspect(subscription);
  assert.equal(present.state, RemoteSubscriptionState.PRESENT);
  assert.equal(present.externalId, '77');
  assert.equal(present.callbackUrl, 'https://naia.test/hook');
});
