import { randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }
function normalizeMime(value) { return String(value ?? '').trim().toLowerCase(); }
function inferMediaType(mimeType) {
  const mime = normalizeMime(mimeType);
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  return 'OTHER';
}
function inferMessagingSource(item) {
  const values = [item?.relativePath, item?.bucketName, item?.displayName, item?.providerName, item?.sourceLabel].map((value) => String(value ?? '').toLowerCase());
  return values.some((value) => value.includes('whatsapp')) ? 'whatsapp' : null;
}

export function createMemoryMediaInventoryStore() {
  const items = new Map();
  const stableIndex = new Map();
  return {
    async save(item) {
      items.set(item.id, clone(item));
      stableIndex.set(item.platform + ':' + item.stableSourceId, item.id);
      return clone(item);
    },
    async findByStableSourceId(platform, stableSourceId) {
      const id = stableIndex.get(platform + ':' + stableSourceId);
      return id ? clone(items.get(id)) : null;
    },
    async list({ sourceType } = {}) {
      return [...items.values()].filter((item) => !sourceType || item.sourceType === sourceType).map(clone);
    },
  };
}

export function createAndroidMediaAdapter({ mediaStore = null, saf = null, permissionState = 'GRANTED' } = {}) {
  return {
    platform: 'android',
    async scan() {
      if (permissionState !== 'GRANTED') return { permissionState, items: [], sources: [] };
      const items = [];
      const sources = [];
      if (typeof mediaStore === 'function') {
        const rows = await mediaStore();
        items.push(...clone(rows ?? []).map((row) => ({ ...row, discoverySource: 'MEDIASTORE' })));
        sources.push('MEDIASTORE');
      }
      if (typeof saf === 'function') {
        const rows = await saf();
        items.push(...clone(rows ?? []).map((row) => ({ ...row, discoverySource: 'SAF' })));
        sources.push('SAF');
      }
      return { permissionState, items, sources };
    },
  };
}

export function createMediaScanService({ store = createMemoryMediaInventoryStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  return {
    async scan(adapter) {
      if (!adapter?.platform || typeof adapter.scan !== 'function') throw new Error('media adapter is required');
      const result = await adapter.scan();
      if (result.permissionState !== 'GRANTED') {
        return { status: 'UNAVAILABLE', permissionState: result.permissionState, imported: 0, duplicates: 0, items: [], sources: result.sources ?? [] };
      }
      let imported = 0;
      let duplicates = 0;
      const seenThisScan = new Set();
      const normalized = [];
      for (const raw of result.items ?? []) {
        const stableSourceId = String(raw?.stableSourceId ?? raw?.uri ?? '').trim();
        if (!stableSourceId) throw new Error('stableSourceId or uri is required');
        if (seenThisScan.has(stableSourceId)) { duplicates += 1; continue; }
        seenThisScan.add(stableSourceId);
        const existing = await store.findByStableSourceId(adapter.platform, stableSourceId);
        if (existing) { duplicates += 1; normalized.push(existing); continue; }
        const sourceType = raw.sourceType ?? inferMessagingSource(raw) ?? 'device';
        const item = {
          id: idFactory(),
          platform: adapter.platform,
          stableSourceId,
          sourceType,
          mediaType: inferMediaType(raw.mimeType),
          mimeType: normalizeMime(raw.mimeType),
          displayName: raw.displayName ?? null,
          sizeBytes: Number.isFinite(Number(raw.sizeBytes)) ? Number(raw.sizeBytes) : null,
          createdAt: raw.createdAt ?? null,
          modifiedAt: raw.modifiedAt ?? null,
          sourceUri: raw.uri ?? raw.sourceUri ?? null,
          folderHint: raw.relativePath ?? raw.bucketName ?? null,
          discoverySource: raw.discoverySource ?? null,
          discoveredAt: now(),
          metadata: clone(raw.metadata ?? {}),
        };
        if (!['IMAGE', 'VIDEO'].includes(item.mediaType)) continue;
        await store.save(item);
        normalized.push(item);
        imported += 1;
      }
      return { status: 'AVAILABLE', permissionState: 'GRANTED', imported, duplicates, items: normalized, sources: result.sources ?? [] };
    },

    async list(filters = {}) { return store.list(filters); },
  };
}

export function registerMediaScanCapability(naia, { service, adapter }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !adapter) throw new Error('media scan service and adapter are required');
  return naia.registerCapability({
    name: 'media.scan',
    tool: { risk: 'READ_ONLY', capability: 'media.inventory', description: 'Scans user-authorized local photos and videos', async run() { return service.scan(adapter); } },
    rule: {
      name: 'media-scan',
      match: ({ title }) => /fotos|videos|m[ií]dia|photos|videos|media/i.test(String(title ?? '')) && /listar|scan|invent[aá]rio|encontrar|find/i.test(String(title ?? '')),
      action: () => ({ tool: 'media.scan', input: {}, risk: 'READ_ONLY', requiresApproval: false }),
    },
  });
}
