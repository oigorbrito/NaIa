import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDriveService,
  createFixtureDriveProvider,
  createMemoryDriveConnectionStore,
  registerDriveCapabilities,
} from '../../src/product/google-drive.mjs';

function fixture() {
  const store = createMemoryDriveConnectionStore();
  const service = createDriveService({ store, now: () => '2026-09-19T12:00:00.000Z' });
  const provider = createFixtureDriveProvider({
    token: 'do-not-persist-me',
    files: [
      { id: 'f1', name: 'Budget 2026', mimeType: 'application/vnd.google-apps.spreadsheet', content: 'Revenue 100\nCost 70', keywords: ['finance'], webViewLink: 'https://drive.google.com/f1' },
      { id: 'f2', name: 'Project Notes', mimeType: 'text/plain', content: 'NaIA roadmap and milestones', keywords: ['roadmap'] },
      { id: 'f3', name: 'Private', mimeType: 'text/plain', content: 'secret', readable: false },
    ],
  });
  return { store, service, provider };
}

test('connect persists only provider-neutral connection metadata, not OAuth token', async () => {
  const { service, provider } = fixture();
  const result = await service.connect({ userId: 'u1', provider });
  assert.equal(result.status, 'CONNECTED');
  const persisted = await service.connection('u1');
  assert.equal(persisted.state, 'CONNECTED');
  assert.equal('token' in persisted, false);
  assert.equal(JSON.stringify(persisted).includes('do-not-persist-me'), false);
});

test('search returns matching Drive metadata after connection', async () => {
  const { service, provider } = fixture();
  await service.connect({ userId: 'u1', provider });
  const result = await service.search({ userId: 'u1', provider, query: 'finance' });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].id, 'f1');
  assert.equal(result.files[0].name, 'Budget 2026');
  assert.equal('content' in result.files[0], false);
});

test('read returns supported document content with source provenance', async () => {
  const { service, provider } = fixture();
  await service.connect({ userId: 'u1', provider });
  const result = await service.read({ userId: 'u1', provider, fileId: 'f2' });
  assert.equal(result.file.content, 'NaIA roadmap and milestones');
  assert.equal(result.file.id, 'f2');
  assert.equal(result.source, 'google_drive');
});

test('provider permission failure is explicit and does not mutate connection', async () => {
  const { service, provider } = fixture();
  await service.connect({ userId: 'u1', provider });
  await assert.rejects(
    service.read({ userId: 'u1', provider, fileId: 'f3' }),
    (error) => error.code === 'PERMISSION_DENIED',
  );
  assert.equal((await service.connection('u1')).state, 'CONNECTED');
});

test('revocation independently blocks future search/read', async () => {
  const { service, provider } = fixture();
  await service.connect({ userId: 'u1', provider });
  const revoked = await service.revoke('u1');
  assert.equal(revoked.revoked, true);
  await assert.rejects(service.search({ userId: 'u1', provider, query: 'Budget' }), (error) => error.code === 'DRIVE_REVOKED');
  await assert.rejects(service.read({ userId: 'u1', provider, fileId: 'f1' }), (error) => error.code === 'DRIVE_REVOKED');
});

test('provider expired authorization fails connection explicitly', async () => {
  const service = createDriveService();
  const provider = createFixtureDriveProvider({ connectionState: 'EXPIRED' });
  const result = await service.connect({ userId: 'u1', provider });
  assert.deepEqual(result, { status: 'UNAVAILABLE', state: 'EXPIRED' });
});

test('Drive capabilities are sensitive reads, never external writes', () => {
  const { service, provider } = fixture();
  const definitions = [];
  const naia = { registerCapability(value) { definitions.push(value); return { name: value.name, risk: value.tool.risk }; } };
  const registered = registerDriveCapabilities(naia, { service, provider, userId: 'u1' });
  assert.deepEqual(registered, [
    { name: 'drive.search', risk: 'SENSITIVE' },
    { name: 'drive.read', risk: 'SENSITIVE' },
  ]);
  assert.ok(definitions.every((definition) => definition.tool.risk !== 'EXTERNAL_WRITE'));
});
