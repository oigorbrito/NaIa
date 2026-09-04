import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ProviderSubscriptionStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  EXPIRING: 'EXPIRING',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
});

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso() { return new Date().toISOString(); }

function normalizeRecord(input) {
  const provider = String(input?.provider ?? '').trim();
  const automationId = String(input?.automationId ?? '').trim();
  if (!provider) throw new Error('subscription provider is required');
  if (!automationId) throw new Error('subscription automationId is required');
  return {
    id: String(input.id ?? randomUUID()),
    provider,
    automationId,
    externalId: input.externalId ? String(input.externalId) : null,
    status: String(input.status ?? ProviderSubscriptionStatus.ACTIVE),
    callbackUrl: String(input.callbackUrl ?? ''),
    expiresAt: input.expiresAt ? String(input.expiresAt) : null,
    metadata: clone(input.metadata ?? {}),
    createdAt: String(input.createdAt ?? nowIso()),
    updatedAt: String(input.updatedAt ?? nowIso()),
    lastError: input.lastError ? String(input.lastError) : null,
  };
}

export function createProviderSubscriptionStore(initial = []) {
  const values = new Map(initial.map((row) => { const record = normalizeRecord(row); return [record.id, record]; }));
  return {
    async save(input) {
      const existing = input?.id ? values.get(String(input.id)) : null;
      const record = normalizeRecord({ ...input, createdAt: existing?.createdAt ?? input?.createdAt, updatedAt: nowIso() });
      values.set(record.id, record);
      return clone(record);
    },
    async get(id) { const row = values.get(String(id)); return row ? clone(row) : null; },
    async find({ provider, automationId } = {}) {
      const row = [...values.values()].find((item) => (!provider || item.provider === provider) && (!automationId || item.automationId === automationId));
      return row ? clone(row) : null;
    },
    async list({ provider, automationId } = {}) {
      return [...values.values()].filter((item) => (!provider || item.provider === provider) && (!automationId || item.automationId === automationId)).map(clone);
    },
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileProviderSubscriptionStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'provider-subscriptions.json');
  async function rows() { return readJson(path, []); }
  return {
    async save(input) {
      const all = await rows();
      const index = input?.id ? all.findIndex((item) => item.id === String(input.id)) : -1;
      const existing = index >= 0 ? all[index] : null;
      const record = normalizeRecord({ ...input, createdAt: existing?.createdAt ?? input?.createdAt, updatedAt: nowIso() });
      if (index >= 0) all[index] = record; else all.push(record);
      await writeJsonAtomic(path, all);
      return clone(record);
    },
    async get(id) { const row = (await rows()).find((item) => item.id === String(id)); return row ? clone(row) : null; },
    async find({ provider, automationId } = {}) {
      const row = (await rows()).find((item) => (!provider || item.provider === provider) && (!automationId || item.automationId === automationId));
      return row ? clone(row) : null;
    },
    async list({ provider, automationId } = {}) {
      return (await rows()).filter((item) => (!provider || item.provider === provider) && (!automationId || item.automationId === automationId)).map(clone);
    },
  };
}

export function createProviderSubscriptionAdapter({ provider, create, renew, stop } = {}) {
  const name = String(provider ?? '').trim();
  if (!name) throw new Error('subscription adapter provider is required');
  if (typeof create !== 'function' || typeof renew !== 'function' || typeof stop !== 'function') throw new Error('subscription adapter create/renew/stop are required');
  return { provider: name, create, renew, stop };
}

export function createGitHubWebhookSubscriptionAdapter(operations = {}) {
  return createProviderSubscriptionAdapter({ provider: 'github', ...operations });
}
export function createGmailWatchSubscriptionAdapter(operations = {}) {
  return createProviderSubscriptionAdapter({ provider: 'gmail', ...operations });
}
export function createGoogleCalendarChannelAdapter(operations = {}) {
  return createProviderSubscriptionAdapter({ provider: 'google-calendar', ...operations });
}

export function createProviderSubscriptionManager({ store, adapters = [] } = {}) {
  if (!store?.save || !store?.find || !store?.list) throw new Error('provider subscription store is required');
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  function adapter(provider) {
    const value = byProvider.get(String(provider));
    if (!value) throw new Error(`provider subscription adapter unavailable: ${provider}`);
    return value;
  }
  return {
    providers() { return [...byProvider.keys()]; },
    async ensure({ provider, automationId, callbackUrl, metadata = {} }) {
      const existing = await store.find({ provider, automationId });
      if (existing && existing.status === ProviderSubscriptionStatus.ACTIVE) return { created: false, subscription: existing };
      try {
        const remote = await adapter(provider).create({ automationId, callbackUrl, metadata, previous: existing });
        const subscription = await store.save({
          ...(existing ?? {}), provider, automationId, callbackUrl,
          externalId: remote?.externalId ?? existing?.externalId ?? null,
          expiresAt: remote?.expiresAt ?? null,
          metadata: { ...metadata, ...(remote?.metadata ?? {}) },
          status: ProviderSubscriptionStatus.ACTIVE,
          lastError: null,
        });
        return { created: true, subscription };
      } catch (error) {
        await store.save({ ...(existing ?? {}), provider, automationId, callbackUrl, metadata, status: ProviderSubscriptionStatus.FAILED, lastError: error?.message ?? String(error) });
        throw error;
      }
    },
    async renew(id) {
      const current = await store.get(id);
      if (!current) throw new Error(`provider subscription not found: ${id}`);
      try {
        const remote = await adapter(current.provider).renew(clone(current));
        return store.save({ ...current, externalId: remote?.externalId ?? current.externalId, expiresAt: remote?.expiresAt ?? current.expiresAt, metadata: { ...current.metadata, ...(remote?.metadata ?? {}) }, status: ProviderSubscriptionStatus.ACTIVE, lastError: null });
      } catch (error) {
        await store.save({ ...current, status: ProviderSubscriptionStatus.FAILED, lastError: error?.message ?? String(error) });
        throw error;
      }
    },
    async stop(id) {
      const current = await store.get(id);
      if (!current) throw new Error(`provider subscription not found: ${id}`);
      await adapter(current.provider).stop(clone(current));
      return store.save({ ...current, status: ProviderSubscriptionStatus.STOPPED, expiresAt: null, lastError: null });
    },
    async expiring({ withinMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
      const all = await store.list();
      const cutoff = now + withinMs;
      const rows = [];
      for (const subscription of all) {
        if (subscription.status !== ProviderSubscriptionStatus.ACTIVE || !subscription.expiresAt) continue;
        const expires = Date.parse(subscription.expiresAt);
        if (Number.isFinite(expires) && expires <= cutoff) {
          rows.push(await store.save({ ...subscription, status: ProviderSubscriptionStatus.EXPIRING }));
        }
      }
      return rows;
    },
    async list(filter = {}) { return store.list(filter); },
  };
}
