import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const PERMISSION_STATES = new Set(['GRANTED', 'DENIED', 'REVOKED']);

function clone(value) { return structuredClone(value); }
function normalizeMime(value) { return String(value ?? 'application/octet-stream').trim().toLowerCase(); }
function normalizeSource(value) { return String(value ?? 'device').trim().toLowerCase(); }

export function classifyFileKind(mimeType, name = '') {
  const mime = normalizeMime(mimeType);
  const lower = String(name).toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'PDF';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('text/') || /\.(txt|md|csv|tsv)$/i.test(lower)) return 'TEXT';
  if (/officedocument|msword|spreadsheet|presentation/.test(mime) || /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(lower)) return 'OFFICE_DOCUMENT';
  return 'OTHER';
}

export function inferWhatsAppOrigin(item) {
  const hints = [item?.path, item?.displayName, item?.providerName, item?.sourceLabel, item?.relativePath].map((value) => String(value ?? '').toLowerCase());
  return hints.some((value) => value.includes('whatsapp')) ? 'whatsapp' : null;
}

export function createMemoryFileInventoryStore() {
  const items = new Map();
  const stableIndex = new Map();
  return {
    async save(item) {
      items.set(item.id, clone(item));
      stableIndex.set(item.platform + ':' + item.stableSourceId, item.id);
      return clone(item);
    },
    async get(id) { const value = items.get(id); return value ? clone(value) : null; },
    async findByStableSourceId(platform, stableSourceId) {
      const id = stableIndex.get(platform + ':' + stableSourceId);
      return id ? clone(items.get(id)) : null;
    },
    async list({ platform, sourceType } = {}) {
      return [...items.values()].filter((item) => (!platform || item.platform === platform) && (!sourceType || item.sourceType === sourceType)).map(clone);
    },
  };
}

async function readInventoryJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { items: {}, stableIndex: {} }; throw error; }
}
async function writeInventoryJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileInventoryStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'file-inventory.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(() => {}).then(async () => {
      const data = await readInventoryJson(path);
      const result = await fn(data);
      await writeInventoryJsonAtomic(path, data);
      return clone(result);
    });
    return chain;
  }
  return {
    path,
    async save(item) {
      return mutate((data) => {
        data.items[item.id] = clone(item);
        data.stableIndex[`${item.platform}:${item.stableSourceId}`] = item.id;
        return item;
      });
    },
    async get(id) { const data = await readInventoryJson(path); return data.items?.[String(id)] ? clone(data.items[String(id)]) : null; },
    async findByStableSourceId(platform, stableSourceId) {
      const data = await readInventoryJson(path);
      const id = data.stableIndex?.[`${platform}:${stableSourceId}`];
      return id && data.items?.[id] ? clone(data.items[id]) : null;
    },
    async list({ platform, sourceType } = {}) {
      const data = await readInventoryJson(path);
      return Object.values(data.items ?? {}).filter((item) => (!platform || item.platform === platform) && (!sourceType || item.sourceType === sourceType)).map(clone);
    },
  };
}

export function createFileInventoryAdapter({ platform, permissionState = 'GRANTED', scan } = {}) {
  if (!platform) throw new Error('platform is required');
  if (!PERMISSION_STATES.has(permissionState)) throw new Error('unsupported permission state: ' + permissionState);
  return {
    platform: String(platform).toLowerCase(),
    async status() { return { permissionState }; },
    async scan() {
      if (permissionState !== 'GRANTED') return { permissionState, items: [] };
      if (typeof scan !== 'function') return { permissionState, items: [] };
      return { permissionState, items: clone(await scan()) };
    },
  };
}


export function createPlatformFileInventoryAdapter({ platformRuntime, capability = 'files.list', mapEntry = null } = {}) {
  if (!platformRuntime || typeof platformRuntime.invoke !== 'function') throw new Error('platform runtime is required');
  const platform = String(platformRuntime.platform ?? '').toLowerCase();
  if (!platform) throw new Error('platform runtime must expose platform');
  return {
    platform,
    async status() {
      const descriptor = typeof platformRuntime.describe === 'function' ? platformRuntime.describe(capability) : null;
      return {
        permissionState: descriptor?.availability === 'PERMISSION_REQUIRED' ? 'DENIED' : descriptor?.availability === 'UNSUPPORTED' || descriptor?.availability === 'UNAVAILABLE' ? 'REVOKED' : 'GRANTED',
        capability,
      };
    },
    async scan() {
      try {
        const result = await platformRuntime.invoke(capability, { operation: 'list' });
        const rows = result?.items ?? result?.entries ?? [];
        return { permissionState: 'GRANTED', items: rows.map((entry) => typeof mapEntry === 'function' ? mapEntry(entry) : entry) };
      } catch (error) {
        if (error?.code === 'PERMISSION_REQUIRED') return { permissionState: 'DENIED', items: [] };
        if (error?.code === 'CAPABILITY_UNAVAILABLE') return { permissionState: 'REVOKED', items: [] };
        throw error;
      }
    },
  };
}
export function createFileInventoryService({ store = createMemoryFileInventoryStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  return {
    async scan(adapter) {
      if (!adapter?.platform || typeof adapter.scan !== 'function') throw new Error('file inventory adapter is required');
      const result = await adapter.scan();
      if (result.permissionState !== 'GRANTED') {
        return { status: 'UNAVAILABLE', permissionState: result.permissionState, imported: 0, duplicates: 0, items: [] };
      }
      let imported = 0;
      let duplicates = 0;
      const normalized = [];
      for (const raw of result.items ?? []) {
        if (!raw?.stableSourceId) throw new Error('stableSourceId is required');
        const existing = await store.findByStableSourceId(adapter.platform, String(raw.stableSourceId));
        if (existing) { duplicates += 1; normalized.push(existing); continue; }
        const sourceType = raw.sourceType ?? inferWhatsAppOrigin(raw) ?? 'device';
        const item = {
          id: idFactory(),
          platform: adapter.platform,
          stableSourceId: String(raw.stableSourceId),
          sourceType: normalizeSource(sourceType),
          displayName: raw.displayName ?? null,
          mimeType: normalizeMime(raw.mimeType),
          fileKind: classifyFileKind(raw.mimeType, raw.displayName),
          sizeBytes: Number.isFinite(Number(raw.sizeBytes)) ? Number(raw.sizeBytes) : null,
          createdAt: raw.createdAt ?? null,
          modifiedAt: raw.modifiedAt ?? null,
          sourceUri: raw.sourceUri ?? null,
          pathHint: raw.path ?? raw.relativePath ?? null,
          discoveredAt: now(),
          metadata: clone(raw.metadata ?? {}),
        };
        await store.save(item);
        imported += 1;
        normalized.push(item);
      }
      return { status: 'AVAILABLE', permissionState: 'GRANTED', imported, duplicates, items: normalized };
    },

    async list(filters = {}) { return store.list(filters); },
  };
}

export function registerFileInventoryCapability(naia, { service, adapter }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !adapter) throw new Error('file inventory service and adapter are required');
  return naia.registerCapability({
    name: 'file.scan',
    tool: {
      risk: 'READ_ONLY',
      capability: 'files.inventory',
      description: 'Inventories user-authorized device documents and files',
      async run() { return service.scan(adapter); },
    },
    rule: {
      name: 'file-scan',
      match: ({ title }) => /arquivos|documentos|files|documents/i.test(String(title ?? '')) && /listar|scan|invent[aá]rio|encontrar|find/i.test(String(title ?? '')),
      action: () => ({ tool: 'file.scan', input: {}, risk: 'READ_ONLY', requiresApproval: false }),
    },
  });
}
