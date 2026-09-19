function clone(value) { return structuredClone(value); }

function dayKey(date) { return date.toISOString().slice(0, 10); }
function monthKey(date) { return date.toISOString().slice(0, 7); }

function windowKey(window, at) {
  if (window === 'DAY') return dayKey(at);
  if (window === 'MONTH') return monthKey(at);
  if (window === 'ACTIVE') return 'ACTIVE';
  throw new Error('unsupported metering window: ' + window);
}

export function createMemoryUsageStore() {
  const counters = new Map();
  const operations = new Map();
  return {
    async consumeAtomic({ counterKey, operationKey, amount }) {
      if (operations.has(operationKey)) return { duplicate: true, used: counters.get(counterKey) ?? 0 };
      const next = (counters.get(counterKey) ?? 0) + amount;
      counters.set(counterKey, next);
      operations.set(operationKey, { counterKey, amount });
      return { duplicate: false, used: next };
    },
    async get(counterKey) { return counters.get(counterKey) ?? 0; },
    async releaseAtomic({ counterKey, operationKey, amount }) {
      if (operations.has(operationKey)) return { duplicate: true, used: counters.get(counterKey) ?? 0 };
      const next = Math.max(0, (counters.get(counterKey) ?? 0) - amount);
      counters.set(counterKey, next);
      operations.set(operationKey, { counterKey, amount: -amount });
      return { duplicate: false, used: next };
    },
  };
}

export function createUsageMeter({ store = createMemoryUsageStore(), entitlements, now = () => new Date() } = {}) {
  if (!entitlements || typeof entitlements.limit !== 'function') throw new Error('entitlement service is required');

  async function inspect({ userId, metric, window }) {
    const at = now();
    const key = windowKey(window, at);
    const counterKey = [userId, metric, key].join(':');
    const limit = await entitlements.limit(userId, metric);
    const used = await store.get(counterKey);
    return { userId, metric, window, windowKey: key, used, limit: limit.value, remaining: limit.value == null ? null : Math.max(0, limit.value - used), planId: limit.planId };
  }

  return {
    inspect,

    async consume({ userId, metric, window, amount = 1, logicalId }) {
      if (!userId || !metric || !logicalId) throw new Error('userId, metric and logicalId are required');
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('amount must be positive');
      const before = await inspect({ userId, metric, window });
      if (before.limit != null && before.used + numericAmount > before.limit) {
        return { ok: false, code: 'LIMIT_REACHED', duplicate: false, ...before };
      }
      const counterKey = [userId, metric, before.windowKey].join(':');
      const operationKey = ['consume', userId, metric, before.windowKey, logicalId].join(':');
      const consumed = await store.consumeAtomic({ counterKey, operationKey, amount: numericAmount });
      const after = await inspect({ userId, metric, window });
      return { ok: true, code: consumed.duplicate ? 'ALREADY_COUNTED' : 'COUNTED', duplicate: consumed.duplicate, ...after };
    },

    async releaseActive({ userId, metric, logicalId, amount = 1 }) {
      const before = await inspect({ userId, metric, window: 'ACTIVE' });
      const counterKey = [userId, metric, before.windowKey].join(':');
      const operationKey = ['release', userId, metric, before.windowKey, logicalId].join(':');
      const released = await store.releaseAtomic({ counterKey, operationKey, amount: Number(amount) });
      const after = await inspect({ userId, metric, window: 'ACTIVE' });
      return { ok: true, duplicate: released.duplicate, ...after };
    },
  };
}

export function createQuotaPolicy({ entitlements, meter } = {}) {
  if (!entitlements || !meter) throw new Error('entitlements and meter are required');
  return {
    async authorize({ userId, capability, usage = null }) {
      const entitlement = await entitlements.can(userId, capability);
      if (!entitlement.allowed) return { allowed: false, reason: 'NOT_ENTITLED', entitlement };
      if (!usage) return { allowed: true, reason: 'ENTITLED', entitlement };
      const snapshot = await meter.inspect({ userId, metric: usage.metric, window: usage.window });
      if (snapshot.limit != null && snapshot.used + (usage.amount ?? 1) > snapshot.limit) {
        return { allowed: false, reason: 'LIMIT_REACHED', entitlement, usage: snapshot };
      }
      return { allowed: true, reason: 'ENTITLED_WITH_QUOTA', entitlement, usage: snapshot };
    },
  };
}
