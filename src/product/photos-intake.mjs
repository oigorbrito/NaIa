import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const AUTH_STATES = new Set(['AUTHORIZED', 'DENIED', 'EXPIRED']);

function clone(value) { return structuredClone(value); }

export function createMemoryPhotosStore() {
  const selections = new Map();
  const sessions = new Map();
  const appAlbums = new Map();
  const selectionIndex = new Map();
  return {
    async saveSelection(item) { selections.set(item.id, clone(item)); selectionIndex.set(`${item.provider}:${item.providerItemId}`, item.id); return clone(item); },
    async findSelection(provider, providerItemId) { const id = selectionIndex.get(`${provider}:${providerItemId}`); return id ? clone(selections.get(id)) : null; },
    async listSelections({ userId } = {}) { return [...selections.values()].filter((row) => !userId || row.userId === userId).map(clone); },
    async saveSession(session) { sessions.set(session.id, clone(session)); return clone(session); },
    async getSession(id) { const value = sessions.get(id); return value ? clone(value) : null; },
    async saveAlbum(album) { appAlbums.set(album.id, clone(album)); return clone(album); },
    async listAlbums({ userId } = {}) { return [...appAlbums.values()].filter((row) => !userId || row.userId === userId).map(clone); },
  };
}

async function readPhotosJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { selections:{}, sessions:{}, albums:{}, selectionIndex:{} }; throw error; }
}
async function writePhotosJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive:true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFilePhotosStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'photos-intake.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(()=>{}).then(async()=>{ const data=await readPhotosJson(path); const result=await fn(data); await writePhotosJsonAtomic(path,data); return clone(result); });
    return chain;
  }
  return {
    path,
    async saveSelection(item) { return mutate((data)=>{ data.selections[item.id]=clone(item); data.selectionIndex[`${item.provider}:${item.providerItemId}`]=item.id; return item; }); },
    async findSelection(provider, providerItemId) { const data=await readPhotosJson(path); const id=data.selectionIndex?.[`${provider}:${providerItemId}`]; return id&&data.selections?.[id]?clone(data.selections[id]):null; },
    async listSelections({ userId } = {}) { const data=await readPhotosJson(path); return Object.values(data.selections??{}).filter((row)=>!userId||row.userId===userId).map(clone); },
    async saveSession(session) { return mutate((data)=>{ data.sessions[session.id]=clone(session); return session; }); },
    async getSession(id) { const data=await readPhotosJson(path); return data.sessions?.[String(id)]?clone(data.sessions[String(id)]):null; },
    async saveAlbum(album) { return mutate((data)=>{ data.albums[album.id]=clone(album); return album; }); },
    async listAlbums({ userId } = {}) { const data=await readPhotosJson(path); return Object.values(data.albums??{}).filter((row)=>!userId||row.userId===userId).map(clone); },
  };
}

export function createPhotosProviderAdapter({
  name = 'google_photos',
  authorizationState = 'AUTHORIZED',
  pages = [],
  createAlbum = null,
} = {}) {
  if (!AUTH_STATES.has(authorizationState)) throw new Error('unsupported authorization state: ' + authorizationState);
  return {
    name,
    capabilities() { return ['select', 'read-selected', 'create-app-album']; },
    async authorization() { return { state: authorizationState }; },
    async beginSelection() {
      if (authorizationState !== 'AUTHORIZED') return { authorizationState, sessionId: null };
      return { authorizationState, sessionId: 'provider-session-1' };
    },
    async page({ pageToken = null } = {}) {
      if (authorizationState !== 'AUTHORIZED') return { authorizationState, items: [], nextPageToken: null, complete: true };
      const index = pageToken == null ? 0 : Number(pageToken);
      const page = pages[index] ?? [];
      const nextIndex = index + 1;
      return {
        authorizationState,
        items: clone(page),
        nextPageToken: nextIndex < pages.length ? String(nextIndex) : null,
        complete: nextIndex >= pages.length,
      };
    },
    async createAppAlbum(input) {
      if (authorizationState !== 'AUTHORIZED') {
        const error = new Error('photos authorization unavailable');
        error.code = 'AUTH_' + authorizationState;
        throw error;
      }
      if (typeof createAlbum === 'function') return createAlbum(clone(input));
      return { providerAlbumId: 'provider-album-1', title: input.title };
    },
  };
}

export function createPhotosIntakeService({ store = createMemoryPhotosStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  return {
    async importSelection({ userId, provider }) {
      if (!userId) throw new Error('userId is required');
      if (!provider || typeof provider.beginSelection !== 'function' || typeof provider.page !== 'function') throw new Error('photos provider adapter is required');
      const start = await provider.beginSelection();
      if (start.authorizationState !== 'AUTHORIZED') {
        return { status: 'UNAVAILABLE', authorizationState: start.authorizationState, imported: 0, items: [] };
      }
      const session = { id: idFactory(), userId, provider: provider.name ?? 'unknown', providerSessionId: start.sessionId, status: 'ACTIVE', importedItemIds: [], createdAt: now(), completedAt: null };
      await store.saveSession(session);

      let token = null;
      const imported = [];
      do {
        const page = await provider.page({ sessionId: start.sessionId, pageToken: token });
        if (page.authorizationState !== 'AUTHORIZED') {
          session.status = 'EXPIRED';
          await store.saveSession(session);
          return { status: 'UNAVAILABLE', authorizationState: page.authorizationState, imported: imported.length, items: imported, session: clone(session) };
        }
        for (const raw of page.items ?? []) {
          const providerName = provider.name ?? 'unknown';
          const existing = typeof store.findSelection === 'function' ? await store.findSelection(providerName, String(raw.id)) : null;
          if (existing) {
            const sessionIds = [...new Set([...(existing.selectionSessionIds ?? [existing.selectionSessionId].filter(Boolean)), session.id])];
            const refreshed = {
              ...existing,
              selectionSessionIds: sessionIds,
              mediaUrl: raw.mediaUrl ?? existing.mediaUrl ?? null,
              mediaUrlExpiresAt: raw.mediaUrlExpiresAt ?? existing.mediaUrlExpiresAt ?? null,
              mimeType: raw.mimeType ?? existing.mimeType ?? null,
              width: raw.width ?? existing.width ?? null,
              height: raw.height ?? existing.height ?? null,
              createdAt: raw.createdAt ?? existing.createdAt ?? null,
              provenance: {
                ...(existing.provenance ?? {}),
                provider: providerName,
                providerItemId: String(raw.id),
                latestProviderSessionId: start.sessionId,
              },
            };
            await store.saveSelection(refreshed);
            session.importedItemIds.push(refreshed.id);
            imported.push({ ...refreshed, duplicate: true });
            continue;
          }
          const item = {
            id: idFactory(),
            userId,
            provider: providerName,
            providerItemId: String(raw.id),
            selectionSessionId: session.id,
            selectionSessionIds: [session.id],
            mimeType: raw.mimeType ?? null,
            width: raw.width ?? null,
            height: raw.height ?? null,
            createdAt: raw.createdAt ?? null,
            mediaUrl: raw.mediaUrl ?? null,
            mediaUrlExpiresAt: raw.mediaUrlExpiresAt ?? null,
            sourceType: 'google_photos_selected',
            provenance: { provider: providerName, providerItemId: String(raw.id), providerSessionId: start.sessionId, latestProviderSessionId: start.sessionId },
          };
          await store.saveSelection(item);
          session.importedItemIds.push(item.id);
          imported.push(item);
        }
        token = page.nextPageToken ?? null;
        if (page.complete) token = null;
      } while (token !== null);

      session.status = 'COMPLETED';
      session.completedAt = now();
      await store.saveSession(session);
      const duplicateCount = imported.filter((item) => item.duplicate).length;
      return { status: 'COMPLETED', authorizationState: 'AUTHORIZED', imported: imported.length - duplicateCount, duplicates: duplicateCount, selected: imported.length, items: imported, session: clone(session) };
    },

    async selectedMedia(userId, { at = now() } = {}) {
      const items = await store.listSelections({ userId });
      return items.map((item) => ({
        ...item,
        mediaAccess: item.mediaUrlExpiresAt && new Date(item.mediaUrlExpiresAt) <= new Date(at) ? 'EXPIRED' : 'AVAILABLE',
      }));
    },

    async capabilities(provider) {
      const capabilities = typeof provider?.capabilities === 'function' ? provider.capabilities() : [];
      return {
        select: capabilities.includes('select'),
        readSelected: capabilities.includes('read-selected'),
        scanEntireLibrary: false,
        organizeExistingLibrary: false,
        createAppAlbum: capabilities.includes('create-app-album'),
      };
    },

    async createAppAlbum({ userId, provider, title }) {
      if (!userId || !String(title ?? '').trim()) throw new Error('userId and title are required');
      const result = await provider.createAppAlbum({ title: String(title).trim() });
      const album = {
        id: idFactory(), userId, provider: provider.name ?? 'unknown', providerAlbumId: result.providerAlbumId, title: result.title ?? String(title).trim(), appCreated: true, createdAt: now(),
      };
      await store.saveAlbum(album);
      return clone(album);
    },
  };
}

export function registerPhotosSelectCapability(naia, { service, provider, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !provider || !userId) throw new Error('photos service/provider/userId are required');
  return naia.registerCapability({
    name: 'photos.select',
    tool: { risk: 'SENSITIVE', capability: 'media.intake', description: 'Imports media explicitly selected by the user from Google Photos', async run() { return service.importSelection({ userId, provider }); } },
    rule: {
      name: 'photos-select',
      match: ({ title }) => /google photos|fotos do google/i.test(String(title ?? '')) && /selecion|import|escolh/i.test(String(title ?? '')),
      action: () => ({ tool: 'photos.select', input: {}, risk: 'SENSITIVE', requiresApproval: true }),
    },
  });
}

export function registerPhotosAppAlbumCapability(naia, { service, provider, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !provider || !userId) throw new Error('photos service/provider/userId are required');
  return naia.registerCapability({
    name: 'photos.appAlbum.create',
    tool: {
      risk: 'EXTERNAL_WRITE', capability: 'media.photos.app-created.write',
      description: 'Creates an app-owned Google Photos album after approval',
      async run(input) { return service.createAppAlbum({ userId, provider, title: input?.title }); },
    },
  });
}
