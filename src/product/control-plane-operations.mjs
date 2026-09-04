import { ProviderSubscriptionStatus } from './provider-subscriptions.mjs';

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso() { return new Date().toISOString(); }

export function createControlPlaneOperations({
  subscriptions,
  schedulerBridge,
  renewalWindowMs = 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  if (!subscriptions?.list || !subscriptions?.expiring || !subscriptions?.renew || !subscriptions?.ensure) {
    throw new Error('provider subscription manager is required');
  }
  if (!schedulerBridge?.sync) throw new Error('scheduler bridge is required');

  async function health() {
    const rows = await subscriptions.list();
    const counts = { ACTIVE: 0, EXPIRING: 0, STOPPED: 0, FAILED: 0, UNKNOWN: 0 };
    const issues = [];
    for (const row of rows) {
      const status = counts[row.status] == null ? 'UNKNOWN' : row.status;
      counts[status] += 1;
      if (row.status === ProviderSubscriptionStatus.FAILED) issues.push({ type: 'FAILED_SUBSCRIPTION', id: row.id, provider: row.provider, automationId: row.automationId, error: row.lastError ?? null });
      if (row.status === ProviderSubscriptionStatus.ACTIVE && row.expiresAt) {
        const expiresAt = Date.parse(row.expiresAt);
        if (Number.isFinite(expiresAt) && expiresAt <= now()) issues.push({ type: 'EXPIRED_SUBSCRIPTION', id: row.id, provider: row.provider, automationId: row.automationId, expiresAt: row.expiresAt });
      }
    }
    return {
      healthy: issues.length === 0,
      checkedAt: new Date(now()).toISOString(),
      subscriptions: { total: rows.length, counts },
      issues,
    };
  }

  async function renewExpiring() {
    const marked = await subscriptions.expiring({ withinMs: renewalWindowMs, now: now() });
    const renewed = [];
    const failed = [];
    for (const row of marked) {
      try { renewed.push(await subscriptions.renew(row.id)); }
      catch (error) { failed.push({ id: row.id, provider: row.provider, automationId: row.automationId, error: error?.message ?? String(error) }); }
    }
    return { scanned: marked.length, renewed, failed };
  }

  async function repairFailed() {
    const rows = await subscriptions.list();
    const failedRows = rows.filter((row) => row.status === ProviderSubscriptionStatus.FAILED);
    const repaired = [];
    const failed = [];
    for (const row of failedRows) {
      try {
        const result = await subscriptions.ensure({
          provider: row.provider,
          automationId: row.automationId,
          callbackUrl: row.callbackUrl,
          metadata: clone(row.metadata ?? {}),
        });
        repaired.push(result.subscription);
      } catch (error) {
        failed.push({ id: row.id, provider: row.provider, automationId: row.automationId, error: error?.message ?? String(error) });
      }
    }
    return { scanned: failedRows.length, repaired, failed };
  }

  async function syncScheduler() {
    try {
      const result = await schedulerBridge.sync();
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  async function runMaintenance({ repair = true } = {}) {
    const startedAt = nowIso();
    const renewal = await renewExpiring();
    const repaired = repair ? await repairFailed() : { scanned: 0, repaired: [], failed: [] };
    const scheduler = await syncScheduler();
    const status = await health();
    return {
      startedAt,
      completedAt: nowIso(),
      renewal,
      repair: repaired,
      scheduler,
      health: status,
      ok: renewal.failed.length === 0 && repaired.failed.length === 0 && scheduler.ok && status.healthy,
    };
  }

  return { health, renewExpiring, repairFailed, syncScheduler, runMaintenance };
}
