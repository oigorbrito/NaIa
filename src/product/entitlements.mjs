const SUBSCRIPTION_STATES = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']);

function clone(value) { return structuredClone(value); }
function normalizeId(value) { return String(value ?? '').trim().toUpperCase(); }
function normalizeCapability(value) { return String(value ?? '').trim().toLowerCase(); }

export const DEFAULT_PLAN_DEFINITIONS = Object.freeze({
  FREE: Object.freeze({
    id: 'FREE',
    capabilities: Object.freeze(['core.chat', 'tasks.reminders', 'nutrition.diary']),
    attributes: Object.freeze({ supportPriority: 'STANDARD' }),
    limits: Object.freeze({
      'executions.daily': 25,
      'executions.monthly': 500,
      'scheduledTasks.active': 5,
      'modelUnits.monthly': 100,
    }),
  }),
  PRO: Object.freeze({
    id: 'PRO',
    capabilities: Object.freeze(['core.chat', 'tasks.reminders', 'nutrition.diary', 'finance.read', 'drive.read', 'email.read', 'email.send', 'media.intake', 'model.advanced']),
    attributes: Object.freeze({ supportPriority: 'PRIORITY' }),
    limits: Object.freeze({
      'executions.daily': 250,
      'executions.monthly': 5000,
      'scheduledTasks.active': 50,
      'modelUnits.monthly': 2500,
    }),
  }),
  ULTRA: Object.freeze({
    id: 'ULTRA',
    capabilities: Object.freeze(['*']),
    attributes: Object.freeze({ supportPriority: 'PRIORITY' }),
    limits: Object.freeze({
      'executions.daily': 1000,
      'executions.monthly': 25000,
      'scheduledTasks.active': 100,
      'modelUnits.monthly': 15000,
    }),
  }),
});

export function createPlanCatalog(definitions = DEFAULT_PLAN_DEFINITIONS) {
  const plans = new Map();
  for (const [key, definition] of Object.entries(definitions)) {
    const id = normalizeId(definition?.id ?? key);
    if (!id) throw new Error('plan id is required');
    plans.set(id, {
      id,
      capabilities: [...new Set((definition?.capabilities ?? []).map(normalizeCapability).filter(Boolean))],
      attributes: { ...(definition?.attributes ?? {}) },
      limits: { ...(definition?.limits ?? {}) },
    });
  }
  if (!plans.has('FREE')) throw new Error('FREE fallback plan is required');
  return {
    get(id) { const value = plans.get(normalizeId(id)); return value ? clone(value) : null; },
    has(id) { return plans.has(normalizeId(id)); },
    list() { return [...plans.values()].map(clone); },
  };
}

export function createMemorySubscriptionStore() {
  const rows = new Map();
  return {
    async save(subscription) { rows.set(subscription.userId, clone(subscription)); return clone(subscription); },
    async get(userId) { const value = rows.get(userId); return value ? clone(value) : null; },
  };
}

function effectivePlanFor(subscription, at) {
  const fallbackPlanId = normalizeId(subscription?.fallbackPlanId ?? 'FREE');
  if (!subscription) return { planId: fallbackPlanId, reason: 'no-subscription', billingState: 'NONE' };
  const state = subscription.state;
  if (state === 'ACTIVE') return { planId: subscription.planId, reason: 'active-subscription', billingState: state };
  if (state === 'TRIAL') {
    const ends = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
    if (!ends || ends > at) return { planId: subscription.planId, reason: 'active-trial', billingState: state };
    return { planId: fallbackPlanId, reason: 'trial-expired', billingState: 'EXPIRED' };
  }
  if (state === 'CANCELLED') {
    const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
    if (periodEnd && periodEnd > at) return { planId: subscription.planId, reason: 'cancelled-until-period-end', billingState: state };
    return { planId: fallbackPlanId, reason: 'cancelled-period-ended', billingState: state };
  }
  if (state === 'PAST_DUE') return { planId: fallbackPlanId, reason: 'past-due-fallback', billingState: state };
  return { planId: fallbackPlanId, reason: 'expired-fallback', billingState: state };
}

export function createEntitlementService({
  catalog = createPlanCatalog(),
  store = createMemorySubscriptionStore(),
  now = () => new Date(),
} = {}) {
  async function resolve(userId) {
    if (!userId) throw new Error('userId is required');
    const subscription = await store.get(userId);
    const effective = effectivePlanFor(subscription, now());
    const plan = catalog.get(effective.planId);
    if (!plan) throw new Error('effective plan not found: ' + effective.planId);
    return { userId, subscription, effectivePlan: plan, ...effective };
  }

  return {
    async setSubscription({ userId, planId, state = 'ACTIVE', fallbackPlanId = 'FREE', trialEndsAt = null, currentPeriodEnd = null }) {
      const normalizedPlan = normalizeId(planId);
      const normalizedFallback = normalizeId(fallbackPlanId);
      const normalizedState = normalizeId(state);
      if (!userId) throw new Error('userId is required');
      if (!catalog.has(normalizedPlan)) throw new Error('unknown plan: ' + normalizedPlan);
      if (!catalog.has(normalizedFallback)) throw new Error('unknown fallback plan: ' + normalizedFallback);
      if (!SUBSCRIPTION_STATES.has(normalizedState)) throw new Error('unsupported subscription state: ' + normalizedState);
      const subscription = { userId, planId: normalizedPlan, state: normalizedState, fallbackPlanId: normalizedFallback, trialEndsAt, currentPeriodEnd };
      await store.save(subscription);
      return clone(subscription);
    },

    async transition(userId, state, changes = {}) {
      const subscription = await store.get(userId);
      if (!subscription) throw new Error('subscription not found: ' + userId);
      const normalizedState = normalizeId(state);
      if (!SUBSCRIPTION_STATES.has(normalizedState)) throw new Error('unsupported subscription state: ' + normalizedState);
      Object.assign(subscription, clone(changes), { state: normalizedState });
      await store.save(subscription);
      return clone(subscription);
    },

    resolve,

    async can(userId, capability) {
      const resolved = await resolve(userId);
      const requested = normalizeCapability(capability);
      const allowed = resolved.effectivePlan.capabilities.includes('*') || resolved.effectivePlan.capabilities.includes(requested);
      return { allowed, capability: requested, planId: resolved.planId, billingState: resolved.billingState, reason: allowed ? 'entitled' : 'capability-not-entitled' };
    },

    async limit(userId, limitName) {
      const resolved = await resolve(userId);
      const value = resolved.effectivePlan.limits[limitName];
      return { limitName, value: Number.isFinite(value) ? value : null, planId: resolved.planId, billingState: resolved.billingState };
    },

    async attribute(userId, name) {
      const resolved = await resolve(userId);
      const value = resolved.effectivePlan.attributes?.[name] ?? null;
      return { name, value, planId: resolved.planId, billingState: resolved.billingState };
    },
  };
}
