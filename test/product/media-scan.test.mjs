import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidMediaAdapter, createMediaScanService, registerMediaScanCapability } from '../../src/product/media-scan.mjs';

test('MediaStore source discovers authorized image/video media', async () => {
  let id = 0;
  const service = createMediaScanService({ idFactory: () => 'media-' + ++id });
  const adapter = createAndroidMediaAdapter({
    mediaStore: async () => [
      { stableSourceId: 'm1', uri: 'content://media/1', mimeType: 'image/jpeg', displayName: 'a.jpg' },
      { stableSourceId: 'm2', uri: 'content://media/2', mimeType: 'video/mp4', displayName: 'b.mp4' },
    ],
  });
  const result = await service.scan(adapter);
  assert.equal(result.imported, 2);
  assert.deepEqual(result.items.map((item) => item.mediaType), ['IMAGE', 'VIDEO']);
  assert.deepEqual(result.sources, ['MEDIASTORE']);
});

test('SAF fallback contributes media through the same normalized contract', async () => {
  const service = createMediaScanService({ idFactory: () => 'media-1' });
  const adapter = createAndroidMediaAdapter({
    saf: async () => [{ stableSourceId: 's1', uri: 'content://saf/1', mimeType: 'image/png', relativePath: 'Pictures/' }],
  });
  const result = await service.scan(adapter);
  assert.equal(result.imported, 1);
  assert.equal(result.items[0].discoverySource, 'SAF');
  assert.deepEqual(result.sources, ['SAF']);
});

test('MediaStore and SAF duplicate discovery is deduplicated in one scan', async () => {
  let id = 0;
  const service = createMediaScanService({ idFactory: () => 'media-' + ++id });
  const shared = { stableSourceId: 'same', uri: 'content://media/same', mimeType: 'image/jpeg', displayName: 'same.jpg' };
  const adapter = createAndroidMediaAdapter({ mediaStore: async () => [shared], saf: async () => [shared] });
  const result = await service.scan(adapter);
  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 1);
  assert.equal((await service.list()).length, 1);
});

test('repeated scan does not create duplicate inventory records', async () => {
  let id = 0;
  const service = createMediaScanService({ idFactory: () => 'media-' + ++id });
  const adapter = createAndroidMediaAdapter({ mediaStore: async () => [{ stableSourceId: 'm1', uri: 'content://media/1', mimeType: 'image/jpeg' }] });
  const first = await service.scan(adapter);
  const second = await service.scan(adapter);
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(second.items[0].id, first.items[0].id);
});

test('permission denial is explicit and non-destructive', async () => {
  const service = createMediaScanService();
  const adapter = createAndroidMediaAdapter({ permissionState: 'DENIED', mediaStore: async () => { throw new Error('must not run'); } });
  const result = await service.scan(adapter);
  assert.deepEqual(result, { status: 'UNAVAILABLE', permissionState: 'DENIED', imported: 0, duplicates: 0, items: [], sources: [] });
});

test('WhatsApp source is attributed only when folder/provider metadata shows it', async () => {
  let id = 0;
  const service = createMediaScanService({ idFactory: () => 'media-' + ++id });
  const adapter = createAndroidMediaAdapter({ mediaStore: async () => [
    { stableSourceId: 'w1', uri: 'content://media/w1', mimeType: 'image/jpeg', relativePath: 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/' },
    { stableSourceId: 'd1', uri: 'content://media/d1', mimeType: 'image/jpeg', relativePath: 'DCIM/Camera/' },
  ] });
  const result = await service.scan(adapter);
  assert.equal(result.items[0].sourceType, 'whatsapp');
  assert.equal(result.items[1].sourceType, 'device');
});

test('non-media rows are ignored rather than polluting media inventory', async () => {
  const service = createMediaScanService({ idFactory: () => 'media-1' });
  const adapter = createAndroidMediaAdapter({ mediaStore: async () => [{ stableSourceId: 'x', uri: 'content://x', mimeType: 'application/pdf' }] });
  const result = await service.scan(adapter);
  assert.equal(result.imported, 0);
  assert.deepEqual(result.items, []);
});

test('media.scan is exposed through normal read-only capability flow', () => {
  const service = createMediaScanService();
  const adapter = createAndroidMediaAdapter();
  let definition;
  const naia = { registerCapability(value) { definition = value; return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerMediaScanCapability(naia, { service, adapter });
  assert.deepEqual(registered, { name: 'media.scan', risk: 'READ_ONLY' });
  assert.equal(definition.rule.match({ title: 'listar fotos do aparelho' }), true);
  assert.equal(definition.rule.action().requiresApproval, false);
});
