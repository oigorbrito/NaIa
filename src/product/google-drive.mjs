import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
function clone(value) { return structuredClone(value); }

const CONNECTION_STATES = new Set(['CONNECTED', 'REVOKED', 'EXPIRED']);
const ALLOWED_READ_SCOPES = new Set(['drive.readonly','drive.metadata.readonly','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.metadata.readonly']);

export function createMemoryDriveConnectionStore() {
  const rows = new Map();
  return {
    async save(connection) { rows.set(connection.id, clone(connection)); return clone(connection); },
    async get(id) { const value = rows.get(id); return value ? clone(value) : null; },
  };
}

async function readDriveJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { connections:{} }; throw error; }
}
async function writeDriveJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive:true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileDriveConnectionStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'drive-connections.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(()=>{}).then(async()=>{ const data=await readDriveJson(path); const result=await fn(data); await writeDriveJsonAtomic(path,data); return clone(result); });
    return chain;
  }
  return {
    path,
    async save(connection) { return mutate((data)=>{ data.connections[connection.id]=clone(connection); return connection; }); },
    async get(id) { const data=await readDriveJson(path); return data.connections?.[String(id)] ? clone(data.connections[String(id)]) : null; },
  };
}

export function createFixtureDriveProvider({
  name = 'google_drive',
  files = [],
  connectionState = 'CONNECTED',
  token = 'fixture-secret-token',
  scopes = ['drive.readonly'],
} = {}) {
  if (!CONNECTION_STATES.has(connectionState)) throw new Error('unsupported connection state: ' + connectionState);
  return {
    name,
    token,
    async status() { return { state: connectionState, scopes: [...scopes] }; },
    async search({ query }) {
      if (connectionState !== 'CONNECTED') {
        const error = new Error('drive connection unavailable');
        error.code = 'DRIVE_' + connectionState;
        throw error;
      }
      const q = String(query ?? '').trim().toLowerCase();
      return files.filter((file) => {
        if (!q) return true;
        return [file.name, file.mimeType, file.content, ...(file.keywords ?? [])].some((value) => String(value ?? '').toLowerCase().includes(q));
      }).map((file) => ({
        id: String(file.id), name: file.name ?? null, mimeType: file.mimeType ?? null, modifiedAt: file.modifiedAt ?? null, sizeBytes: file.sizeBytes ?? null, webViewLink: file.webViewLink ?? null,
      }));
    },
    async read({ fileId }) {
      if (connectionState !== 'CONNECTED') {
        const error = new Error('drive connection unavailable');
        error.code = 'DRIVE_' + connectionState;
        throw error;
      }
      const file = files.find((row) => String(row.id) === String(fileId));
      if (!file) { const error = new Error('drive file not found: ' + fileId); error.code = 'NOT_FOUND'; throw error; }
      if (file.readable === false) { const error = new Error('drive file permission denied'); error.code = 'PERMISSION_DENIED'; throw error; }
      return {
        id: String(file.id), name: file.name ?? null, mimeType: file.mimeType ?? null, content: file.content ?? null, modifiedAt: file.modifiedAt ?? null, sourceUrl: file.webViewLink ?? null,
      };
    },
  };
}

export function createDriveService({ store = createMemoryDriveConnectionStore(), now = () => new Date().toISOString() } = {}) {
  async function requireConnection(userId) {
    const connection = await store.get('drive:' + userId);
    if (!connection) throw new Error('drive connection not found');
    if (connection.state !== 'CONNECTED') {
      const error = new Error('drive connection unavailable: ' + connection.state);
      error.code = 'DRIVE_' + connection.state;
      throw error;
    }
    return connection;
  }

  return {
    async connect({ userId, provider, credentialRef = null }) {
      if (!userId || !provider) throw new Error('userId and provider are required');
      const status = await provider.status();
      if (status.state !== 'CONNECTED') {
        return { status: 'UNAVAILABLE', state: status.state };
      }
      const scopes = [...new Set((status.scopes ?? []).map(String))];
      const unsafeScopes = scopes.filter((scope) => !ALLOWED_READ_SCOPES.has(scope));
      if (unsafeScopes.length) {
        const error = new Error('Drive connector requested non-read-only scope');
        error.code = 'UNSAFE_DRIVE_SCOPE';
        error.scopes = unsafeScopes;
        throw error;
      }
      const connection = {
        id: 'drive:' + userId,
        userId,
        provider: provider.name ?? 'google_drive',
        scopes,
        credentialRef: credentialRef ? String(credentialRef) : null,
        state: 'CONNECTED',
        connectedAt: now(),
        revokedAt: null,
      };
      await store.save(connection);
      return { status: 'CONNECTED', connection: clone(connection) };
    },

    async revoke(userId) {
      const connection = await store.get('drive:' + userId);
      if (!connection) return { revoked: false, reason: 'not-connected' };
      connection.state = 'REVOKED';
      connection.revokedAt = now();
      await store.save(connection);
      return { revoked: true, connection: clone(connection) };
    },

    async search({ userId, provider, query }) {
      await requireConnection(userId);
      try {
        const files = await provider.search({ query });
        return { query: String(query ?? ''), files: clone(files), source: provider.name ?? 'google_drive' };
      } catch (error) {
        const wrapped = new Error(error?.message ?? 'drive search failed');
        wrapped.code = error?.code ?? 'DRIVE_PROVIDER_ERROR';
        throw wrapped;
      }
    },

    async read({ userId, provider, fileId }) {
      await requireConnection(userId);
      try {
        const file = await provider.read({ fileId });
        return { file: clone(file), source: provider.name ?? 'google_drive' };
      } catch (error) {
        const wrapped = new Error(error?.message ?? 'drive read failed');
        wrapped.code = error?.code ?? 'DRIVE_PROVIDER_ERROR';
        throw wrapped;
      }
    },

    async connection(userId) { return store.get('drive:' + userId); },
  };
}

export function registerDriveCapabilities(naia, { service, provider, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !provider || !userId) throw new Error('drive service/provider/userId are required');
  return [
    naia.registerCapability({
      name: 'drive.search',
      tool: { risk: 'SENSITIVE', capability: 'drive.read', description: 'Searches files in a connected Google Drive account', async run(input) { return service.search({ userId, provider, ...input }); } },
      rule: {
        name: 'drive-search',
        match: ({ title }) => /drive/i.test(String(title ?? '')) && /procure|buscar|busque|search|find/i.test(String(title ?? '')),
        action: ({ title }) => ({ tool: 'drive.search', input: { query: String(title ?? '') }, risk: 'SENSITIVE', requiresApproval: true }),
      },
    }),
    naia.registerCapability({
      name: 'drive.read',
      tool: { risk: 'SENSITIVE', capability: 'drive.read', description: 'Reads supported file content from connected Google Drive', async run(input) { return service.read({ userId, provider, ...input }); } },
      rule: {
        name: 'drive-read',
        match: ({ title }) => /drive/i.test(String(title ?? '')) && /leia|ler|read|abrir|open/i.test(String(title ?? '')),
        action: ({ id }) => ({ tool: 'drive.read', input: { fileId: id }, risk: 'SENSITIVE', requiresApproval: true }),
      },
    }),
  ];
}
