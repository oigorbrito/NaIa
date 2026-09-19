import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFilePhotosStore, createPhotosIntakeService, createPhotosProviderAdapter, registerPhotosAppAlbumCapability, registerPhotosSelectCapability } from '../../src/product/photos-intake.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

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

test('file-backed selected media and session provenance survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naia-photos-'));
  try {
    let id = 0;
    const provider = createPhotosProviderAdapter({ pages:[[{ id:'p1', mimeType:'image/jpeg', mediaUrl:'https://temp/1', mediaUrlExpiresAt:'2026-09-20T00:00:00Z' }]] });
    const first = createPhotosIntakeService({ store:createFilePhotosStore({ rootDir:dir }), idFactory:()=>`id-${++id}`, now:()=> '2026-09-19T12:00:00Z' });
    const imported = await first.importSelection({ userId:'u1', provider });
    assert.equal(imported.imported,1);
    const second = createPhotosIntakeService({ store:createFilePhotosStore({ rootDir:dir }), now:()=> '2026-09-19T13:00:00Z' });
    const [item] = await second.selectedMedia('u1');
    assert.equal(item.providerItemId,'p1');
    assert.equal(item.selectionSessionIds.length,1);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('re-selecting same provider item refreshes temporary access but does not duplicate logical media', async () => {
  let id = 0;
  let pass = 0;
  const provider = {
    name:'google_photos',
    capabilities:()=>['select','read-selected','create-app-album'],
    async beginSelection(){pass+=1;return {authorizationState:'AUTHORIZED',sessionId:`provider-session-${pass}`};},
    async page(){return {authorizationState:'AUTHORIZED',items:[{id:'p1',mimeType:'image/jpeg',mediaUrl:`https://temp/${pass}`,mediaUrlExpiresAt:`2026-09-${20+pass}T00:00:00Z`}],nextPageToken:null,complete:true};},
  };
  const service=createPhotosIntakeService({idFactory:()=>`id-${++id}`,now:()=> '2026-09-19T12:00:00Z'});
  const first=await service.importSelection({userId:'u1',provider});
  const second=await service.importSelection({userId:'u1',provider});
  assert.equal(first.imported,1);
  assert.equal(second.imported,0);
  assert.equal(second.duplicates,1);
  const items=await service.selectedMedia('u1');
  assert.equal(items.length,1);
  assert.equal(items[0].mediaUrl,'https://temp/2');
  assert.equal(items[0].selectionSessionIds.length,2);
});

test('provider secret/token is never persisted in selected item/session state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naia-photos-secret-'));
  try {
    let id=0;
    const provider={
      name:'google_photos', token:'super-secret-oauth-token', capabilities:()=>['select','read-selected'],
      async beginSelection(){return {authorizationState:'AUTHORIZED',sessionId:'provider-session-1'};},
      async page(){return {authorizationState:'AUTHORIZED',items:[{id:'p1'}],nextPageToken:null,complete:true};},
    };
    const store=createFilePhotosStore({rootDir:dir});
    const service=createPhotosIntakeService({store,idFactory:()=>`id-${++id}`});
    await service.importSelection({userId:'u1',provider});
    const text=await readFile(store.path,'utf8');
    assert.equal(text.includes('super-secret-oauth-token'),false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('app-created album creation is normal EXTERNAL_WRITE and requires runtime approval', async () => {
  let created=0;
  const provider=createPhotosProviderAdapter({createAlbum:async({title})=>{created+=1;return {providerAlbumId:'album-1',title};}});
  const service=createPhotosIntakeService({idFactory:()=> 'album-local-1'});
  const naia=createNaiaService(createInMemoryPorts());
  registerPhotosAppAlbumCapability(naia,{service,provider,userId:'u1'});
  const pending=await naia.pursueAction({title:'Create app album',action:{tool:'photos.appAlbum.create',input:{title:'NaIA Receipts'},risk:'EXTERNAL_WRITE',requiresApproval:true}});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  assert.equal(created,0);
  const completed=await naia.approve(pending.objective.id,'photos.appAlbum.create');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(created,1);
});
