import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AutomationTriggerKind } from './automations.mjs';

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso() { return new Date().toISOString(); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function deriveIdempotencyKey(delivery) {
  if (delivery?.idempotencyKey) return String(delivery.idempotencyKey);
  const material = JSON.stringify(canonical({ automationId: delivery?.automationId, trigger: delivery?.trigger ?? {}, parameters: delivery?.parameters ?? {} }));
  return createHash('sha256').update(material).digest('hex');
}

function normalizeDelivery(kind, input = {}) {
  const automationId = String(input.automationId ?? '').trim();
  if (!automationId) throw new Error('trigger delivery automationId is required');
  const trigger = { ...(input.trigger ?? {}), kind };
  if (kind === AutomationTriggerKind.SCHEDULE) {
    const scheduledFor = String(input.scheduledFor ?? trigger.scheduledFor ?? '').trim();
    if (!scheduledFor) throw new Error('schedule delivery requires scheduledFor');
    trigger.scheduledFor = scheduledFor;
  }
  if (kind === AutomationTriggerKind.EVENT) {
    const eventId = String(input.eventId ?? trigger.eventId ?? '').trim();
    if (!eventId) throw new Error('event delivery requires eventId');
    trigger.eventId = eventId;
  }
  return {
    automationId,
    trigger,
    parameters: clone(input.parameters ?? {}),
    idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
    receivedAt: String(input.receivedAt ?? nowIso()),
    source: String(input.source ?? trigger.source ?? ''),
  };
}

export function createManualTriggerAdapter() { return { kind: AutomationTriggerKind.MANUAL, normalize(input) { return normalizeDelivery(AutomationTriggerKind.MANUAL, input); } }; }
export function createScheduleTriggerAdapter() { return { kind: AutomationTriggerKind.SCHEDULE, normalize(input) { return normalizeDelivery(AutomationTriggerKind.SCHEDULE, input); } }; }
export function createEventTriggerAdapter() { return { kind: AutomationTriggerKind.EVENT, normalize(input) { return normalizeDelivery(AutomationTriggerKind.EVENT, input); } }; }

export function createTriggerAdapterRegistry(adapters = [createManualTriggerAdapter(), createScheduleTriggerAdapter(), createEventTriggerAdapter()]) {
  const byKind = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
  return {
    normalize(input) {
      const kind = String(input?.trigger?.kind ?? input?.kind ?? AutomationTriggerKind.MANUAL).toUpperCase();
      const adapter = byKind.get(kind);
      if (!adapter) throw new Error(`trigger adapter unavailable: ${kind}`);
      return adapter.normalize(input);
    },
    kinds() { return [...byKind.keys()]; },
  };
}

export function createAutomationRunStore(initial = []) {
  const rows = initial.map((row) => clone(row));
  return {
    async append(run) { rows.push(clone(run)); return clone(run); },
    async list({ automationId } = {}) { return rows.filter((row) => !automationId || row.automationId === automationId).map(clone); },
    async findByIdempotencyKey(key) { const row = rows.find((item) => item.idempotencyKey === key); return row ? clone(row) : null; },
    async update(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`automation run not found: ${id}`);
      rows[index] = { ...rows[index], ...clone(patch), updatedAt: nowIso() };
      return clone(rows[index]);
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

export function createFileAutomationRunStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'automation-runs.json');
  return {
    async append(run) {
      const rows = await readJson(path, []);
      rows.push(clone(run));
      await writeJsonAtomic(path, rows);
      return clone(run);
    },
    async list({ automationId } = {}) {
      const rows = await readJson(path, []);
      return rows.filter((row) => !automationId || row.automationId === automationId).map(clone);
    },
    async findByIdempotencyKey(key) {
      const rows = await readJson(path, []);
      const row = rows.find((item) => item.idempotencyKey === key);
      return row ? clone(row) : null;
    },
    async update(id, patch) {
      const rows = await readJson(path, []);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`automation run not found: ${id}`);
      rows[index] = { ...rows[index], ...clone(patch), updatedAt: nowIso() };
      await writeJsonAtomic(path, rows);
      return clone(rows[index]);
    },
  };
}

export function createAutomationTriggerRuntime({ naia, runs, adapters = createTriggerAdapterRegistry() } = {}) {
  if (!naia?.triggerAutomation) throw new Error('naia.triggerAutomation is required');
  if (!runs?.append || !runs?.findByIdempotencyKey || !runs?.list || !runs?.update) throw new Error('automation run store is required');

  async function reconcile(row) {
    if (!row?.objectiveId || typeof naia.get !== 'function') return row;
    const snapshot = await naia.get(row.objectiveId);
    const objectiveStatus = snapshot?.objective?.status;
    if (!objectiveStatus || objectiveStatus === row.status) return row;
    return runs.update(row.id, { status: objectiveStatus });
  }

  return {
    adapters() { return adapters.kinds(); },
    async dispatch(rawDelivery) {
      const delivery = adapters.normalize(rawDelivery);
      const idempotencyKey = deriveIdempotencyKey(delivery);
      const existing = await runs.findByIdempotencyKey(idempotencyKey);
      if (existing) return { deduplicated: true, run: await reconcile(existing) };
      const createdAt = nowIso();
      const run = await runs.append({
        id: randomUUID(), automationId: delivery.automationId, idempotencyKey,
        trigger: clone(delivery.trigger), parameters: clone(delivery.parameters), source: delivery.source,
        status: 'RECEIVED', objectiveId: null, createdAt, updatedAt: createdAt,
      });
      try {
        const proposed = await naia.triggerAutomation(delivery.automationId, delivery.trigger, delivery.parameters);
        const updated = await runs.update(run.id, { status: 'WAITING_CONFIRMATION', objectiveId: proposed.objective.id });
        return { deduplicated: false, run: updated, proposal: proposed.proposal, objective: proposed.objective };
      } catch (error) {
        await runs.update(run.id, { status: 'REJECTED', error: error?.message ?? String(error) });
        throw error;
      }
    },
    async history(automationId) {
      const rows = await runs.list({ automationId });
      const reconciled = [];
      for (const row of rows) reconciled.push(await reconcile(row));
      return reconciled.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
  };
}
