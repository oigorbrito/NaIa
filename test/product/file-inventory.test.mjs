import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFileKind,
  createFileInventoryAdapter,
  createFileInventoryService,
  createMemoryFileInventoryStore,
  inferWhatsAppOrigin,
  registerFileInventoryCapability,
} from '../../src/product/file-inventory.mjs';

test('classifies supported document types without platform-specific imports', () => {
  assert.equal(classifyFileKind('application/pdf', 'bill.pdf'), 'PDF');
  assert.equal(classifyFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx'), 'OFFICE_DOCUMENT');
  assert.equal(classifyFileKind('text/plain', 'notes.txt'), 'TEXT');
  assert.equal(classifyFileKind('image/jpeg', 'scan.jpg'), 'IMAGE');
});

test('discovers WhatsApp-origin file when authorized metadata makes it observable', async () => {
  const service = createFileInventoryService({ idFactory: () => 'file-1', now: () => '2026-09-19T12:00:00.000Z' });
  const adapter = createFileInventoryAdapter({
    platform: 'android',
    scan: async () => [{
      stableSourceId: 'content-1', displayName: 'invoice.pdf', mimeType: 'application/pdf',
      relativePath: 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/',
      sourceUri: 'content://docs/1', sizeBytes: 1234,
    }],
  });
  const result = await service.scan(adapter);
  assert.equal(result.imported, 1);
  assert.equal(result.items[0].sourceType, 'whatsapp');
  assert.equal(result.items[0].sourceUri, 'content://docs/1');
});

test('permission denial and revocation are explicit non-destructive states', async () => {
  for (const permissionState of ['DENIED', 'REVOKED']) {
    const service = createFileInventoryService();
    const adapter = createFileInventoryAdapter({ platform: 'android', permissionState, scan: async () => { throw new Error('must not scan'); } });
    const result = await service.scan(adapter);
    assert.deepEqual(result, { status: 'UNAVAILABLE', permissionState, imported: 0, duplicates: 0, items: [] });
  }
});

test('duplicate discovery reuses stable inventory item instead of creating duplicate logical file', async () => {
  const store = createMemoryFileInventoryStore();
  let id = 0;
  const service = createFileInventoryService({ store, idFactory: () => 'file-' + ++id });
  const adapter = createFileInventoryAdapter({
    platform: 'android',
    scan: async () => [{ stableSourceId: 'same-1', displayName: 'a.pdf', mimeType: 'application/pdf', sourceUri: 'content://same-1' }],
  });
  const first = await service.scan(adapter);
  const second = await service.scan(adapter);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(second.items[0].id, first.items[0].id);
  assert.equal((await service.list()).length, 1);
});

test('source attribution does not invent WhatsApp when metadata has no evidence', () => {
  assert.equal(inferWhatsAppOrigin({ relativePath: 'Documents/Receipts/' }), null);
  assert.equal(inferWhatsAppOrigin({ providerName: 'WhatsApp Documents' }), 'whatsapp');
});

test('inventory preserves stable IDs, MIME, size, timestamps and source metadata', async () => {
  const service = createFileInventoryService({ idFactory: () => 'file-7', now: () => '2026-09-19T12:00:00.000Z' });
  const adapter = createFileInventoryAdapter({
    platform: 'desktop',
    scan: async () => [{
      stableSourceId: 'inode-7', displayName: 'contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 2222, createdAt: '2026-08-01T10:00:00Z', modifiedAt: '2026-09-01T10:00:00Z',
      sourceUri: 'file:///docs/contract.docx', metadata: { volume: 'home' },
    }],
  });
  const { items } = await service.scan(adapter);
  assert.deepEqual(items[0], {
    id: 'file-7', platform: 'desktop', stableSourceId: 'inode-7', sourceType: 'device',
    displayName: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileKind: 'OFFICE_DOCUMENT', sizeBytes: 2222, createdAt: '2026-08-01T10:00:00Z', modifiedAt: '2026-09-01T10:00:00Z',
    sourceUri: 'file:///docs/contract.docx', pathHint: null, discoveredAt: '2026-09-19T12:00:00.000Z', metadata: { volume: 'home' },
  });
});

test('file.scan registers as normal read-only NaIA capability', () => {
  const service = createFileInventoryService();
  const adapter = createFileInventoryAdapter({ platform: 'android' });
  let definition;
  const naia = { registerCapability(value) { definition = value; return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerFileInventoryCapability(naia, { service, adapter });
  assert.deepEqual(registered, { name: 'file.scan', risk: 'READ_ONLY' });
  assert.equal(definition.rule.match({ title: 'listar documentos do aparelho' }), true);
  const action = definition.rule.action();
  assert.equal(action.requiresApproval, false);
  assert.equal(action.risk, 'READ_ONLY');
});
