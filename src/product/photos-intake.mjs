import { randomUUID } from 'node:crypto';

const AUTH_STATES = new Set(['AUTHORIZED', 'DENIED', 'EXPIRED']);

function clone(value) { return structuredClone(value); }

export function createMemoryPhotosStore() {
  const selections = new Map();
  const sessions = new Map();
  const appAlbums = new Map();
  return {
    async saveSelection(item) { selections.set(item.id, clone(item)); return clone(item); },
    async listSelections({ userId } = {}) { return [...selections.values()].filter((row) => !userId || row.userId === userId).map(clone); },
    async saveSession(session) { sessions.set(session.id, clone(session)); return clone(session); },
    async getSession(id) { const value = sessions.get(id); return value ? clone(value) : null; },
    async saveAlbum(album) { appAlbums.set(album.id, clone(album)); return clone(album); },
    async listAlbums({ userId } = {}) { return [...appAlbums.values()].filter((row) => !userId || row.userId === userId).map(clone); },
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
          const item = {
            id: idFactory(),
            userId,
            provider: provider.name ?? 'unknown',
            providerItemId: String(raw.id),
            selectionSessionId: session.id,
            mimeType: raw.mimeType ?? null,
            width: raw.width ?? null,
            height: raw.height ?? null,
            createdAt: raw.createdAt ?? null,
            mediaUrl: raw.mediaUrl ?? null,
            mediaUrlExpiresAt: raw.mediaUrlExpiresAt ?? null,
            sourceType: 'google_photos_selected',
            provenance: { provider: provider.name ?? 'unknown', providerItemId: String(raw.id), providerSessionId: start.sessionId },
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
      return { status: 'COMPLETED', authorizationState: 'AUTHORIZED', imported: imported.length, items: imported, session: clone(session) };
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
