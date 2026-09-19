import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAN_DEFINITIONS,
  createEntitlementService,
  createMemorySubscriptionStore,
  createPlanCatalog,
} from '../../src/product/entitlements.mjs';
import { createMemoryUsageStore, createQuotaPolicy, createUsageMeter } from '../../src/product/metering.mjs';

test('default Free/Pro/Ultra contracts expose deterministic scheduled-task limits', () => {
  assert.equal(DEFAULT_PLAN_DEFINITIONS.FREE.limits['scheduledTasks.active'], 5);
  assert.equal(DEFAULT_PLAN_DEFINITIONS.PRO.limits['scheduledTasks.active'], 50);
  assert.equal(DEFAULT_PLAN_DEFINITIONS.ULTRA.limits['scheduledTasks.active'], 100);
});

test('runtime answers concrete capability access from effective plan', async () => {
  const service = createEntitlementService();
  await service.setSubscription({ userId: 'u1', planId: 'PRO', state: 'ACTIVE' });
  assert.equal((await service.can('u1', 'email.send')).allowed, true);
  const denied = await service.can('u1', 'unknown.premium.capability');
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'capability-not-entitled');
});

test('trial expiration deterministically falls back without deleting subscription data', async () => {
  let clock = new Date('2026-09-19T12:00:00Z');
  const store = createMemorySubscriptionStore();
  const service = createEntitlementService({ store, now: () => clock });
  await service.setSubscription({
    userId: 'u1', planId: 'PRO', state: 'TRIAL', fallbackPlanId: 'FREE',
    trialEndsAt: '2026-09-20T00:00:00Z',
  });
  assert.equal((await service.resolve('u1')).planId, 'PRO');
  clock = new Date('2026-09-21T00:00:00Z');
  const resolved = await service.resolve('u1');
  assert.equal(resolved.planId, 'FREE');
  assert.equal(resolved.reason, 'trial-expired');
  assert.equal((await store.get('u1')).planId, 'PRO');
});

test('cancelled plan remains active through paid period then downgrades', async () => {
  let clock = new Date('2026-09-19T12:00:00Z');
  const service = createEntitlementService({ now: () => clock });
  await service.setSubscription({ userId: 'u1', planId: 'PRO', state: 'CANCELLED', currentPeriodEnd: '2026-09-30T00:00:00Z' });
  assert.equal((await service.resolve('u1')).planId, 'PRO');
  clock = new Date('2026-10-01T00:00:00Z');
  assert.equal((await service.resolve('u1')).planId, 'FREE');
});

test('past-due subscription fails safely to configured fallback tier', async () => {
  const service = createEntitlementService();
  await service.setSubscription({ userId: 'u1', planId: 'ULTRA', state: 'PAST_DUE', fallbackPlanId: 'FREE' });
  const resolved = await service.resolve('u1');
  assert.equal(resolved.planId, 'FREE');
  assert.equal(resolved.reason, 'past-due-fallback');
});

test('usage counting is idempotent for one logical execution', async () => {
  const entitlements = createEntitlementService();
  await entitlements.setSubscription({ userId: 'u1', planId: 'FREE' });
  const meter = createUsageMeter({ entitlements });
  const first = await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'run-1' });
  const duplicate = await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'run-1' });
  assert.equal(first.code, 'COUNTED');
  assert.equal(duplicate.code, 'ALREADY_COUNTED');
  assert.equal(duplicate.used, 1);
});

test('quota boundary fails closed with LIMIT_REACHED', async () => {
  const catalog = createPlanCatalog({
    FREE: { id: 'FREE', capabilities: ['core.chat'], limits: { 'executions.daily': 1 } },
  });
  const entitlements = createEntitlementService({ catalog });
  const meter = createUsageMeter({ entitlements });
  assert.equal((await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'a' })).ok, true);
  const blocked = await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'b' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'LIMIT_REACHED');
  assert.equal(blocked.used, 1);
});

test('daily and monthly windows reset independently with clock progression', async () => {
  let clock = new Date('2026-09-19T12:00:00Z');
  const catalog = createPlanCatalog({
    FREE: { id: 'FREE', capabilities: ['core.chat'], limits: { 'executions.daily': 2, 'executions.monthly': 3 } },
  });
  const entitlements = createEntitlementService({ catalog, now: () => clock });
  const meter = createUsageMeter({ entitlements, now: () => clock });
  await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'd1' });
  await meter.consume({ userId: 'u1', metric: 'executions.monthly', window: 'MONTH', logicalId: 'm1' });
  clock = new Date('2026-09-20T12:00:00Z');
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'executions.daily', window: 'DAY' })).used, 0);
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'executions.monthly', window: 'MONTH' })).used, 1);
  clock = new Date('2026-10-01T12:00:00Z');
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'executions.monthly', window: 'MONTH' })).used, 0);
});

test('active scheduled-task quota can be released without deleting task data', async () => {
  const entitlements = createEntitlementService();
  const meter = createUsageMeter({ entitlements });
  await meter.consume({ userId: 'u1', metric: 'scheduledTasks.active', window: 'ACTIVE', logicalId: 'task-1' });
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'scheduledTasks.active', window: 'ACTIVE' })).used, 1);
  await meter.releaseActive({ userId: 'u1', metric: 'scheduledTasks.active', logicalId: 'task-1-release' });
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'scheduledTasks.active', window: 'ACTIVE' })).used, 0);
});

test('concurrent consumption cannot oversubscribe an atomic quota', async () => {
  const catalog = createPlanCatalog({
    FREE: { id: 'FREE', capabilities: ['core.chat'], limits: { 'executions.daily': 1 } },
  });
  const entitlements = createEntitlementService({ catalog });
  const store = createMemoryUsageStore();
  const meter = createUsageMeter({ entitlements, store });
  const [a, b] = await Promise.all([
    meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'a' }),
    meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'b' }),
  ]);
  assert.equal([a, b].filter((row) => row.ok).length, 1);
  assert.equal([a, b].filter((row) => !row.ok && row.code === 'LIMIT_REACHED').length, 1);
  assert.equal((await meter.inspect({ userId: 'u1', metric: 'executions.daily', window: 'DAY' })).used, 1);
});

test('quota policy combines capability entitlement and remaining allowance', async () => {
  const catalog = createPlanCatalog({
    FREE: { id: 'FREE', capabilities: ['email.read'], limits: { 'executions.daily': 1 } },
  });
  const entitlements = createEntitlementService({ catalog });
  const meter = createUsageMeter({ entitlements });
  const policy = createQuotaPolicy({ entitlements, meter });
  assert.equal((await policy.authorize({ userId: 'u1', capability: 'email.send' })).reason, 'NOT_ENTITLED');
  assert.equal((await policy.authorize({ userId: 'u1', capability: 'email.read', usage: { metric: 'executions.daily', window: 'DAY' } })).allowed, true);
  await meter.consume({ userId: 'u1', metric: 'executions.daily', window: 'DAY', logicalId: 'run-1' });
  assert.equal((await policy.authorize({ userId: 'u1', capability: 'email.read', usage: { metric: 'executions.daily', window: 'DAY' } })).reason, 'LIMIT_REACHED');
});
