import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderSubscriptionStore, createProviderSubscriptionManager, createProviderSubscriptionAdapter, ProviderSubscriptionStatus } from '../../src/product/provider-subscriptions.mjs';
import { createControlPlaneOperations } from '../../src/product/control-plane-operations.mjs';
import { createControlPlaneJournal } from '../../src/product/control-plane-journal.mjs';

function adapter(provider, calls) {
  return createProviderSubscriptionAdapter({
    provider,
    async create(input) { calls.push(['create', input.automationId]); return { externalId: `ext-${input.automationId}`, expiresAt: new Date(Date.now() + 3600000).toISOString() }; },
    async renew(input) { calls.push(['renew', input.automationId]); return { externalId: input.externalId, expiresAt: new Date(Date.now() + 7200000).toISOString() }; },
    async stop(input) { calls.push(['stop', input.automationId]); return true; },
  });
}

test('health reports failed and expired subscriptions', async () => {
  const store = createProviderSubscriptionStore([
    { id: 'f1', provider: 'gmail', automationId: 'a1', status: 'FAILED', lastError: 'boom' },
    { id: 'e1', provider: 'gmail', automationId: 'a2', status: 'ACTIVE', expiresAt: '2026-09-01T00:00:00Z' },
  ]);
  const manager = createProviderSubscriptionManager({ store, adapters: [adapter('gmail', [])] });
  const ops = createControlPlaneOperations({ subscriptions: manager, schedulerBridge: { async sync() { return { registered: 0, active: [] }; } }, now: () => Date.parse('2026-09-04T00:00:00Z') });
  const status = await ops.health();
  assert.equal(status.healthy, false);
  assert.equal(status.issues.length, 2);
});

test('renewExpiring renews subscriptions inside configured window', async () => {
  const calls = [];
  const store = createProviderSubscriptionStore([{ id: 'r1', provider: 'gmail', automationId: 'a1', status: 'ACTIVE', expiresAt: '2026-09-04T01:00:00Z' }]);
  const manager = createProviderSubscriptionManager({ store, adapters: [adapter('gmail', calls)] });
  const ops = createControlPlaneOperations({ subscriptions: manager, schedulerBridge: { async sync() { return { registered: 0, active: [] }; } }, renewalWindowMs: 2 * 60 * 60 * 1000, now: () => Date.parse('2026-09-04T00:00:00Z') });
  const result = await ops.renewExpiring();
  assert.equal(result.scanned, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(calls[0][0], 'renew');
});

test('repairFailed recreates failed subscription through ensure', async () => {
  const calls = [];
  const store = createProviderSubscriptionStore([{ id: 'f1', provider: 'github', automationId: 'auto', status: ProviderSubscriptionStatus.FAILED, callbackUrl: 'https://example.test/hook', metadata: { repository: 'o/r' } }]);
  const manager = createProviderSubscriptionManager({ store, adapters: [adapter('github', calls)] });
  const ops = createControlPlaneOperations({ subscriptions: manager, schedulerBridge: { async sync() { return { registered: 0, active: [] }; } } });
  const result = await ops.repairFailed();
  assert.equal(result.repaired.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(calls[0][0], 'create');
});

test('runMaintenance journals renewal repair scheduler and health snapshot', async () => {
  const store = createProviderSubscriptionStore([]);
  const manager = createProviderSubscriptionManager({ store, adapters: [adapter('gmail', [])] });
  const journal = createControlPlaneJournal();
  const ops = createControlPlaneOperations({ subscriptions: manager, journal, schedulerBridge: { async sync() { return { registered: 2, active: [{ automationId: 'a' }, { automationId: 'b' }] }; } } });
  const entry = await ops.runMaintenance();
  assert.equal(entry.ok, true);
  assert.equal(entry.scheduler.registered, 2);
  const history = await ops.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].ok, true);
});
