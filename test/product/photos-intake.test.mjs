import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotosIntakeService, createPhotosProviderAdapter, registerPhotosSelectCapability } from '../../src/product/photos-intake.mjs';

test('authorization denial is explicit and non-destructive', async () => {
  const service = createPhotosIntakeService();
  const provider = createPhotosProviderAdapter({ authorizationState: 'DENIED' });
  const result = await service.importSelection({ userId: 'u1', provider });
  assert.deepEqual(result, { status: 'UNAVAILABLE', authorizationState: 'DENIED', imported: 0, items: [] });
});

test('empty user selection completes without claiming full-library visibility', async () => {
  const service = createPhotosIntakeService({ idFactory: (() => { let i = 0; return () => 'id-' + ++i; })() });
  const provider = createPhotosProviderAdapter({ pages: [[]] });
  const result = await service.importSelection({ userId: 'u1', provider });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.imported, 0);
  const capabilities = await service.capabilities(provider);
  assert.equal(capabilities.scanEntireLibrary, false);
  assert.equal(capabilities.organizeExistingLibrary, false);
});

test('pagination imports explicitly selected items and preserves selection-session provenance', async () => {
  let id = 0;
  const service = createPhotosIntakeService({ idFactory: () => 'id-' + ++id, now: () => '2026-09-19T12:00:00.000Z' });
  const provider = createPhotosProviderAdapter({
    pages: [
      [{ id: 'p1', mimeType: 'image/jpeg', mediaUrl: 'https://temp/1', mediaUrlExpiresAt: '2026-09-20T00:00:00Z' }],
      [{ id: 'p2', mimeType: 'video/mp4', mediaUrl: 'https://temp/2', mediaUrlExpiresAt: '2026-09-20T00:00:00Z' }],
    ],
  });
  const result = await service.importSelection({ userId: 'u1', provider });
  assert.equal(result.imported, 2);
  assert.equal(result.session.status, 'COMPLETED');
  assert.equal(result.items[0].selectionSessionId, result.session.id);
  assert.equal(result.items[0].provenance.providerItemId, 'p1');
  assert.equal(result.items[1].provenance.providerItemId, 'p2');
});

test('expired media URL is represented explicitly instead of silently treated as readable', async () => {
  let id = 0;
  const service = createPhotosIntakeService({ idFactory: () => 'id-' + ++id });
  const provider = createPhotosProviderAdapter({ pages: [[{ id: 'p1', mediaUrl: 'https://temp/1', mediaUrlExpiresAt: '2026-09-18T00:00:00Z' }]] });
  await service.importSelection({ userId: 'u1', provider });
  const [item] = await service.selectedMedia('u1', { at: '2026-09-19T00:00:00Z' });
  assert.equal(item.mediaAccess, 'EXPIRED');
});

test('authorization can expire during pagination without corrupting already imported provenance', async () => {
  let page = 0;
  const provider = {
    name: 'google_photos',
    capabilities: () => ['select', 'read-selected', 'create-app-album'],
    async beginSelection() { return { authorizationState: 'AUTHORIZED', sessionId: 'provider-session-x' }; },
    async page() {
      page += 1;
      if (page === 1) return { authorizationState: 'AUTHORIZED', items: [{ id: 'p1' }], nextPageToken: '1', complete: false };
      return { authorizationState: 'EXPIRED', items: [], nextPageToken: null, complete: true };
    },
  };
  let id = 0;
  const service = createPhotosIntakeService({ idFactory: () => 'id-' + ++id });
  const result = await service.importSelection({ userId: 'u1', provider });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.authorizationState, 'EXPIRED');
  assert.equal(result.imported, 1);
  assert.equal(result.items[0].provenance.providerItemId, 'p1');
});

test('app-created album operations remain isolated from existing user library', async () => {
  let id = 0;
  const service = createPhotosIntakeService({ idFactory: () => 'id-' + ++id });
  const provider = createPhotosProviderAdapter({ createAlbum: async ({ title }) => ({ providerAlbumId: 'album-9', title }) });
  const album = await service.createAppAlbum({ userId: 'u1', provider, title: 'NaIA Receipts' });
  assert.equal(album.appCreated, true);
  assert.equal(album.providerAlbumId, 'album-9');
  const capabilities = await service.capabilities(provider);
  assert.equal(capabilities.createAppAlbum, true);
  assert.equal(capabilities.organizeExistingLibrary, false);
});

test('photos.select is sensitive and requires normal NaIA approval', () => {
  const service = createPhotosIntakeService();
  const provider = createPhotosProviderAdapter();
  let definition;
  const naia = { registerCapability(value) { definition = value; return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerPhotosSelectCapability(naia, { service, provider, userId: 'u1' });
  assert.deepEqual(registered, { name: 'photos.select', risk: 'SENSITIVE' });
  assert.equal(definition.rule.action().requiresApproval, true);
  assert.equal(definition.rule.action().risk, 'SENSITIVE');
});
