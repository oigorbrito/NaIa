import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(value) { return structuredClone(value); }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function keyOf(ref) {
  if (!ref?.sourceType || !ref?.sourceItemId) throw new Error('artifact sourceType and sourceItemId are required');
  return String(ref.sourceType) + ':' + String(ref.sourceItemId);
}

export function createMemoryArchiveStore() {
  const collections = new Map();
  const operations = new Map();
  return {
    async saveCollection(collection) { collections.set(collection.id, clone(collection)); return clone(collection); },
    async getCollection(id) { const value = collections.get(id); return value ? clone(value) : null; },
    async listCollections({ userId } = {}) { return [...collections.values()].filter((row) => !userId || row.userId === userId).map(clone); },
    async saveOperation(operation) { operations.set(operation.id, clone(operation)); return clone(operation); },
    async getOperation(id) { const value = operations.get(id); return value ? clone(value) : null; },
  };
}

async function readArchiveJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { collections: {}, operations: {} }; throw error; }
}
async function writeArchiveJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileArchiveStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'archive-organization.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(() => {}).then(async () => {
      const data = await readArchiveJson(path);
      const result = await fn(data);
      await writeArchiveJsonAtomic(path, data);
      return clone(result);
    });
    return chain;
  }
  return {
    path,
    async saveCollection(collection) { return mutate((data) => { data.collections[collection.id] = clone(collection); return collection; }); },
    async getCollection(id) { const data = await readArchiveJson(path); return data.collections?.[String(id)] ? clone(data.collections[String(id)]) : null; },
    async listCollections({ userId } = {}) { const data = await readArchiveJson(path); return Object.values(data.collections ?? {}).filter((row) => !userId || row.userId === userId).map(clone); },
    async saveOperation(operation) { return mutate((data) => { data.operations[operation.id] = clone(operation); return operation; }); },
    async getOperation(id) { const data = await readArchiveJson(path); return data.operations?.[String(id)] ? clone(data.operations[String(id)]) : null; },
  };
}

export function createSourceOrganizationAdapter({ sourceType, capabilities = [], executor = null } = {}) {
  if (!sourceType) throw new Error('sourceType is required');
  const supported = new Set(capabilities.map(String));
  return {
    sourceType: String(sourceType),
    supports(operation) { return supported.has(operation); },
    async execute(operation, input) {
      if (!supported.has(operation)) {
        const error = new Error('source operation unavailable: ' + sourceType + '/' + operation);
        error.code = 'CAPABILITY_UNAVAILABLE';
        throw error;
      }
      if (typeof executor !== 'function') return { ok: true, operation, input: clone(input) };
      return executor(operation, clone(input));
    },
  };
}

export function createArchiveService({ store = createMemoryArchiveStore(), adapters = [], idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  const adapterMap = new Map(adapters.map((adapter) => [adapter.sourceType, adapter]));

  async function requireCollection(id) {
    const collection = await store.getCollection(id);
    if (!collection) throw new Error('collection not found: ' + id);
    return collection;
  }

  return {
    async createCollection({ userId, name, tags = [] }) {
      if (!userId || !String(name ?? '').trim()) throw new Error('userId and collection name are required');
      const collection = {
        id: idFactory(), userId, name: String(name).trim(),
        tags: [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))],
        artifacts: [], bundles: [], createdAt: now(), updatedAt: now(),
      };
      await store.saveCollection(collection);
      return clone(collection);
    },

    async addArtifact(collectionId, ref) {
      const collection = await requireCollection(collectionId);
      const key = keyOf(ref);
      if (!collection.artifacts.some((item) => keyOf(item) === key)) {
        collection.artifacts.push({
          sourceType: ref.sourceType, sourceItemId: ref.sourceItemId, sourceUri: ref.sourceUri ?? null,
          documentId: ref.documentId ?? null, mediaId: ref.mediaId ?? null, metadata: clone(ref.metadata ?? {}),
        });
        collection.updatedAt = now();
        await store.saveCollection(collection);
      }
      return clone(collection);
    },

    async removeArtifact(collectionId, ref) {
      const collection = await requireCollection(collectionId);
      const key = keyOf(ref);
      collection.artifacts = collection.artifacts.filter((item) => keyOf(item) !== key);
      collection.bundles = collection.bundles.map((bundle) => ({ ...bundle, artifactKeys: bundle.artifactKeys.filter((item) => item !== key) })).filter((bundle) => bundle.artifactKeys.length > 0);
      collection.updatedAt = now();
      await store.saveCollection(collection);
      return clone(collection);
    },

    async addReconciliationBundle(collectionId, { reconciliation, documents }) {
      const collection = await requireCollection(collectionId);
      if (!['MATCHED', 'PROBABLE_MATCH', 'AMBIGUOUS'].includes(reconciliation?.state)) throw new Error('reconciliation state cannot form a bundle');
      const ids = [reconciliation.billId, reconciliation.receiptId].filter(Boolean);
      for (const candidate of reconciliation.candidates ?? []) ids.push(candidate.receiptId);
      const byId = new Map((documents ?? []).map((doc) => [doc.id, doc]));
      const artifactKeys = [];
      for (const id of [...new Set(ids)]) {
        const doc = byId.get(id);
        if (!doc?.sourceType || !doc?.sourceItemId) continue;
        const ref = { sourceType: doc.sourceType, sourceItemId: doc.sourceItemId, sourceUri: doc.sourceUri ?? null, documentId: doc.id };
        const key = keyOf(ref);
        artifactKeys.push(key);
        if (!collection.artifacts.some((item) => keyOf(item) === key)) collection.artifacts.push(ref);
      }
      const bundleId = 'reconciliation:' + String(reconciliation.billId ?? idFactory());
      const existing = collection.bundles.find((bundle) => bundle.id === bundleId);
      const bundle = { id: bundleId, type: 'BILL_RECEIPT', reconciliationState: reconciliation.state, confidence: reconciliation.confidence ?? null, artifactKeys: [...new Set(artifactKeys)] };
      if (existing) Object.assign(existing, bundle); else collection.bundles.push(bundle);
      collection.updatedAt = now();
      await store.saveCollection(collection);
      return clone(collection);
    },

    async previewSourceMutation({ userId, sourceType, operation, artifacts, destination = null }) {
      if (!userId) throw new Error('userId is required');
      const adapter = adapterMap.get(sourceType);
      const supported = Boolean(adapter?.supports(operation));
      return {
        sourceType, operation, supported, destination,
        artifacts: clone(artifacts ?? []),
        risk: 'EXTERNAL_WRITE',
        requiresApproval: true,
        unavailableReason: supported ? null : 'CAPABILITY_UNAVAILABLE',
      };
    },

    async createSourceMutationOperation({ userId, sourceType, operation, artifacts, destination = null, idempotencyKey }) {
      const preview = await this.previewSourceMutation({ userId, sourceType, operation, artifacts, destination });
      const id = idempotencyKey ? 'archive-op:' + idempotencyKey : idFactory();
      const existing = await store.getOperation(id);
      if (existing) return { operation: existing, duplicate: true };
      const record = {
        id, userId, sourceType, operation, artifacts: clone(artifacts ?? []), destination,
        fingerprint: fingerprint({ userId, sourceType, operation, artifacts: clone(artifacts ?? []), destination }),
        supported: preview.supported, status: preview.supported ? 'PENDING_APPROVAL' : 'UNAVAILABLE',
        approvedAt: null, executedAt: null, result: null, createdAt: now(),
      };
      await store.saveOperation(record);
      return { operation: clone(record), duplicate: false };
    },

    async executePrepared(operationId, expectedFingerprint = null) {
      const record = await store.getOperation(operationId);
      if (!record) throw new Error('archive operation not found: ' + operationId);
      if (expectedFingerprint && record.fingerprint !== expectedFingerprint) {
        const error = new Error('archive operation fingerprint mismatch'); error.code = 'ACTION_STALE'; throw error;
      }
      if (record.status === 'COMPLETED') return { operation: record, duplicate: true };
      if (!record.supported) { const error = new Error('source operation unavailable'); error.code = 'CAPABILITY_UNAVAILABLE'; throw error; }
      const adapter = adapterMap.get(record.sourceType);
      if (!adapter?.supports(record.operation)) { const error = new Error('source capability no longer available'); error.code = 'CAPABILITY_REVOKED'; throw error; }
      record.approvedAt = record.approvedAt ?? now();
      const result = await adapter.execute(record.operation, { artifacts: record.artifacts, destination: record.destination, operationId: record.id });
      record.status = 'COMPLETED'; record.executedAt = now(); record.result = clone(result);
      await store.saveOperation(record);
      return { operation: clone(record), duplicate: false };
    },

    async approveAndExecute(operationId) {
      return this.executePrepared(operationId);
    },
  };
}

export function registerArchiveCapabilities(naia, { service } = {}) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service) throw new Error('archive service is required');
  return naia.registerCapability({
    name: 'archive.execute',
    tool: {
      risk: 'EXTERNAL_WRITE', capability: 'archive.source.write',
      description: 'Executes one concrete prepared source organization mutation',
      async run(input) { return service.executePrepared(input.operationId, input.fingerprint); },
    },
  });
}

export async function proposeArchiveMutation(naia, prepared) {
  if (!naia || typeof naia.pursueAction !== 'function') throw new Error('NaIA pursueAction is required');
  const operation = prepared?.operation ?? prepared;
  if (!operation?.id || !operation?.fingerprint) throw new Error('prepared archive operation is required');
  return naia.pursueAction({
    id: `archive-objective:${operation.id}`,
    title: `Archive ${operation.operation} on ${operation.sourceType}`,
    intent: 'ARCHIVE_SOURCE_MUTATION',
    action: {
      tool: 'archive.execute',
      input: { operationId: operation.id, fingerprint: operation.fingerprint },
      risk: 'EXTERNAL_WRITE', requiresApproval: true,
    },
  });
}
