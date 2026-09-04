import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderSubscriptionStore,
  createProviderSubscriptionManager,
  createGitHubWebhookSubscriptionAdapter,
} from '../../src/product/provider-subscriptions.mjs';
import {
  RemoteSubscriptionState,
  SubscriptionDriftKind,
  createRemoteSubscriptionProbe,
  createRemoteSubscriptionProbeRegistry,
  createSubscriptionReconciler,
  createGitHubWebhookRemoteProbe,
} from '../../src/product/remote-state-reconciliation.mjs';
import { runControlPlaneCommand } from '../../src/product/control-plane-cli.mjs';

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, async text() { return body == null ? '' : JSON.stringify(body); } };
}

test('missing remote subscription is detected and repaired by recreate', async () => {
  const calls = [];
  const store = createProviderSubscriptionStore([{ id: 's1', provider: 'github', automationId: 'a1', externalId: 'old', status: 'ACTIVE', callbackUrl: 'https://naia.test/hook', metadata: { repository: 'tihotm/NaIa' } }]);
  const manager = createProviderSubscriptionManager({
    store,
    adapters: [createGitHubWebhookSubscriptionAdapter({
      async create(input) { calls.push(['create', input.automationId]); return { externalId: 'new', metadata: { repository: 'tihotm/NaIa' } }; },
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
  const row = await manager.get('s1');
  assert.equal(row.externalId, 'new');
  assert.equal(row.status, 'ACTIVE');
});

test('stopped local subscription with remote presence is classified as orphan and stopped remotely', async () => {
  let stops = 0;
  const store = createProviderSubscriptionStore([{ id: 's2', provider: 'github', automationId: 'a2', externalId: 'remote-2', status: 'STOPPED', callbackUrl: 'https://naia.test/hook', metadata: { repository: 'tihotm/NaIa' } }]);
  const manager = createProviderSubscriptionManager({
    store,
    adapters: [createGitHubWebhookSubscriptionAdapter({ async create() { return {}; }, async renew() { return {}; }, async stop() { stops += 1; return true; } })],
  });
  const probes = createRemoteSubscriptionProbeRegistry([createRemoteSubscriptionProbe({ provider: 'github', async inspect() { return { state: 'PRESENT', externalId: 'remote-2' }; } })]);
  const reconciler = createSubscriptionReconciler({ subscriptions: manager, probes });
  const report = await reconciler.reconcile();
  assert.equal(report.actionable[0].kind, SubscriptionDriftKind.ORPHAN_REMOTE);
  await reconciler.repair(report);
  assert.equal(stops, 1);
  assert.equal((await manager.get('s2')).status, 'STOPPED');
});

test('github remote probe maps 404 to missing and reads callback identity when present', async () => {
  let mode = 'missing';
  const probe = createGitHubWebhookRemoteProbe({
    token: 'token',
    fetchImpl: async () => mode === 'missing' ? response(404, { message: 'Not Found' }) : response(200, { id: 77, active: true, events: ['issues'], config: { url: 'https://naia.test/hook' } }),
  });
  const subscription = { provider: 'github', externalId: '77', callbackUrl: 'https://naia.test/hook', metadata: { repository: 'tihotm/NaIa' } };
  assert.equal((await probe.inspect(subscription)).state, 'MISSING');
  mode = 'present';
  const present = await probe.inspect(subscription);
  assert.equal(present.state, 'PRESENT');
  assert.equal(present.externalId, '77');
  assert.equal(present.callbackUrl, 'https://naia.test/hook');
});

test('remote callback drift is actionable', async () => {
  const manager = {
    async list() { return [{ id: 's3', provider: 'github', automationId: 'a3', externalId: '3', status: 'ACTIVE', callbackUrl: 'https://local.test' }]; },
    async recreate() {}, async stop() {},
  };
  const probes = createRemoteSubscriptionProbeRegistry([createRemoteSubscriptionProbe({ provider: 'github', async inspect() { return { state: 'PRESENT', externalId: '3', callbackUrl: 'https://remote.test' }; } })]);
  const report = await createSubscriptionReconciler({ subscriptions: manager, probes }).reconcile();
  assert.equal(report.actionable[0].kind, SubscriptionDriftKind.CALLBACK_DRIFT);
});

test('operational CLI routes health, reconcile, repair and history without embedding scheduling', async () => {
  const calls = [];
  const controlPlane = {
    schedulerConfigured: false,
    clients: ['github'],
    subscriptions: { async list() { calls.push('subscriptions'); return [{ id: 's1' }]; } },
    operations: {
      async health() { calls.push('health'); return { healthy: true }; },
      async renewExpiring() { calls.push('renew'); return { scanned: 0 }; },
      async syncScheduler() { calls.push('sync'); return { ok: false, error: 'external scheduler is not configured' }; },
      async runMaintenance() { calls.push('maintenance'); return { ok: true }; },
      async history({ limit }) { calls.push(`history:${limit}`); return []; },
    },
    reconciler: {
      async reconcile() { calls.push('reconcile'); return { healthy: true, actionable: [] }; },
      async repair() { calls.push('repair'); return { repaired: [], failed: [] }; },
    },
  };
  const health = await runControlPlaneCommand({ controlPlane, command: 'health' });
  assert.equal(health.healthy, true);
  assert.equal(health.schedulerConfigured, false);
  await runControlPlaneCommand({ controlPlane, command: 'repair' });
  await runControlPlaneCommand({ controlPlane, command: 'history', args: ['7'] });
  assert.deepEqual(calls, ['health', 'reconcile', 'reconcile', 'repair', 'history:7']);
});
