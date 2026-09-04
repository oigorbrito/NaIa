import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createAutomationRunStore, createAutomationTriggerRuntime } from '../../src/product/trigger-runtime.mjs';
import { createScheduleSource } from '../../src/product/schedule-source.mjs';
import { createInMemorySchedulerAdapter, createSchedulerBridge } from '../../src/product/scheduler-adapter.mjs';
import {
  ProviderSubscriptionStatus,
  createProviderSubscriptionStore,
  createProviderSubscriptionManager,
  createGitHubWebhookSubscriptionAdapter,
  createGmailWatchSubscriptionAdapter,
  createGoogleCalendarChannelAdapter,
} from '../../src/product/provider-subscriptions.mjs';

function workflow(text = 'ok') {
  return { id: `wf-${text}`, steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text } }] };
}

test('provider subscription ensure is idempotent and renew/stop preserve lifecycle', async () => {
  const store = createProviderSubscriptionStore();
  let creates = 0;
  let renews = 0;
  let stops = 0;
  const github = createGitHubWebhookSubscriptionAdapter({
    async create() { creates += 1; return { externalId: 'hook-1', expiresAt: '2026-09-05T00:00:00Z' }; },
    async renew(current) { renews += 1; return { externalId: current.externalId, expiresAt: '2026-09-06T00:00:00Z' }; },
    async stop() { stops += 1; },
  });
  const manager = createProviderSubscriptionManager({ store, adapters: [github] });
  const first = await manager.ensure({ provider: 'github', automationId: 'a1', callbackUrl: 'https://example.test/webhooks/github/a1' });
  const second = await manager.ensure({ provider: 'github', automationId: 'a1', callbackUrl: 'https://example.test/webhooks/github/a1' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(creates, 1);
  const renewed = await manager.renew(first.subscription.id);
  assert.equal(renewed.expiresAt, '2026-09-06T00:00:00Z');
  assert.equal(renews, 1);
  const stopped = await manager.stop(first.subscription.id);
  assert.equal(stopped.status, ProviderSubscriptionStatus.STOPPED);
  assert.equal(stops, 1);
});

test('expiring marks only active subscriptions inside renewal window', async () => {
  const store = createProviderSubscriptionStore([
    { id: 'soon', provider: 'gmail', automationId: 'a', status: 'ACTIVE', expiresAt: '2026-09-04T02:00:00Z' },
    { id: 'later', provider: 'gmail', automationId: 'b', status: 'ACTIVE', expiresAt: '2026-09-06T02:00:00Z' },
    { id: 'stopped', provider: 'gmail', automationId: 'c', status: 'STOPPED', expiresAt: '2026-09-04T02:00:00Z' },
  ]);
  const noop = { async create() {}, async renew() {}, async stop() {} };
  const manager = createProviderSubscriptionManager({ store, adapters: [createGmailWatchSubscriptionAdapter(noop)] });
  const rows = await manager.expiring({ now: Date.parse('2026-09-04T00:00:00Z'), withinMs: 3 * 60 * 60 * 1000 });
  assert.deepEqual(rows.map((row) => row.id), ['soon']);
  assert.equal(rows[0].status, ProviderSubscriptionStatus.EXPIRING);
});

test('provider-specific adapter constructors expose canonical provider names', () => {
  const ops = { async create() {}, async renew() {}, async stop() {} };
  assert.equal(createGitHubWebhookSubscriptionAdapter(ops).provider, 'github');
  assert.equal(createGmailWatchSubscriptionAdapter(ops).provider, 'gmail');
  assert.equal(createGoogleCalendarChannelAdapter(ops).provider, 'google-calendar');
});

test('scheduler bridge registers enabled schedule automations and removes stale registrations', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({ id: 'daily', name: 'Daily', enabled: true, trigger: { kind: 'SCHEDULE', schedule: '0 9 * * *', timezone: 'America/Sao_Paulo' }, workflow: workflow('daily') });
  await naia.createAutomation({ id: 'disabled', name: 'Disabled', enabled: false, trigger: { kind: 'SCHEDULE', schedule: '* * * * *' }, workflow: workflow('disabled') });
  const scheduler = createInMemorySchedulerAdapter();
  await scheduler.register({ automationId: 'stale', schedule: '* * * * *', timezone: 'UTC' });
  const runtime = createAutomationTriggerRuntime({ naia, runs: createAutomationRunStore() });
  const bridge = createSchedulerBridge({ naia, scheduler, scheduleSource: createScheduleSource({ naia, runtime }) });
  const synced = await bridge.sync();
  assert.equal(synced.registered, 1);
  assert.deepEqual((await scheduler.list()).map((row) => row.automationId), ['daily']);
});

test('scheduler occurrence feeds schedule source and replay is deduplicated', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({ id: 'daily', name: 'Daily', enabled: true, trigger: { kind: 'SCHEDULE', schedule: '0 9 * * *' }, workflow: workflow('daily') });
  const runtime = createAutomationTriggerRuntime({ naia, runs: createAutomationRunStore() });
  const bridge = createSchedulerBridge({ naia, scheduler: createInMemorySchedulerAdapter(), scheduleSource: createScheduleSource({ naia, runtime }) });
  const input = { automationId: 'daily', scheduledFor: '2026-09-04T09:00:00Z' };
  const first = await bridge.occurrence(input);
  const second = await bridge.occurrence(input);
  assert.equal(first.deduplicated, false);
  assert.equal(first.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(second.deduplicated, true);
});
