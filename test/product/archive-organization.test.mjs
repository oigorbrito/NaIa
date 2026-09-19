import assert from 'node:assert/strict';
import test from 'node:test';
import { createArchiveService, createMemoryArchiveStore, createSourceOrganizationAdapter } from '../../src/product/archive-organization.mjs';

function fixture() {
  const store = createMemoryArchiveStore();
  let id = 0;
  const driveCalls = [];
  const drive = createSourceOrganizationAdapter({
    sourceType: 'google_drive', capabilities: ['move', 'label'],
    executor: async (operation, input) => { driveCalls.push({ operation, input }); return { ok: true, operation, destination: input.destination }; },
  });
  const photos = createSourceOrganizationAdapter({ sourceType: 'google_photos', capabilities: [] });
  const service = createArchiveService({ store, adapters: [drive, photos], idFactory: () => 'id-' + ++id, now: () => '2026-09-19T12:00:00.000Z' });
  return { service, store, driveCalls };
}

test('virtual collection groups artifacts from multiple sources without source mutation', async () => {
  const { service, driveCalls } = fixture();
  const collection = await service.createCollection({ userId: 'u1', name: 'Taxes 2026', tags: ['taxes'] });
  await service.addArtifact(collection.id, { sourceType: 'google_drive', sourceItemId: 'drive-1', sourceUri: 'drive://1' });
  const grouped = await service.addArtifact(collection.id, { sourceType: 'whatsapp', sourceItemId: 'wa-1', sourceUri: 'whatsapp://1' });
  assert.equal(grouped.artifacts.length, 2);
  assert.equal(driveCalls.length, 0);
});

test('bill + receipt reconciliation bundle preserves both source identities', async () => {
  const { service } = fixture();
  const collection = await service.createCollection({ userId: 'u1', name: 'Bills' });
  const documents = [
    { id: 'b1', sourceType: 'google_drive', sourceItemId: 'bill.pdf', sourceUri: 'drive://bill.pdf' },
    { id: 'r1', sourceType: 'whatsapp', sourceItemId: 'receipt.jpg', sourceUri: 'whatsapp://receipt.jpg' },
  ];
  const updated = await service.addReconciliationBundle(collection.id, { reconciliation: { state: 'MATCHED', billId: 'b1', receiptId: 'r1', confidence: 1 }, documents });
  assert.equal(updated.bundles.length, 1);
  assert.deepEqual(new Set(updated.bundles[0].artifactKeys), new Set(['google_drive:bill.pdf', 'whatsapp:receipt.jpg']));
  assert.equal(updated.artifacts.length, 2);
});

test('removing virtual grouping does not execute source mutation', async () => {
  const { service, driveCalls } = fixture();
  const collection = await service.createCollection({ userId: 'u1', name: 'Work' });
  await service.addArtifact(collection.id, { sourceType: 'google_drive', sourceItemId: 'x' });
  const updated = await service.removeArtifact(collection.id, { sourceType: 'google_drive', sourceItemId: 'x' });
  assert.equal(updated.artifacts.length, 0);
  assert.equal(driveCalls.length, 0);
});

test('Drive mutation starts as approval-pending and executes only after explicit approval call', async () => {
  const { service, driveCalls } = fixture();
  const created = await service.createSourceMutationOperation({
    userId: 'u1', sourceType: 'google_drive', operation: 'move',
    artifacts: [{ sourceType: 'google_drive', sourceItemId: 'f1' }], destination: 'folder-9', idempotencyKey: 'move-1',
  });
  assert.equal(created.operation.status, 'PENDING_APPROVAL');
  assert.equal(driveCalls.length, 0);
  const executed = await service.approveAndExecute(created.operation.id);
  assert.equal(executed.operation.status, 'COMPLETED');
  assert.equal(driveCalls.length, 1);
});

test('unsupported Google Photos mutation is explicit capability-unavailable', async () => {
  const { service } = fixture();
  const preview = await service.previewSourceMutation({ userId: 'u1', sourceType: 'google_photos', operation: 'move', artifacts: [] });
  assert.equal(preview.supported, false);
  assert.equal(preview.unavailableReason, 'CAPABILITY_UNAVAILABLE');
  const created = await service.createSourceMutationOperation({ userId: 'u1', sourceType: 'google_photos', operation: 'move', artifacts: [], idempotencyKey: 'photos-1' });
  assert.equal(created.operation.status, 'UNAVAILABLE');
  await assert.rejects(service.approveAndExecute(created.operation.id), (error) => error.code === 'CAPABILITY_UNAVAILABLE');
});

test('retrying same approved organization operation is idempotent', async () => {
  const { service, driveCalls } = fixture();
  const first = await service.createSourceMutationOperation({ userId: 'u1', sourceType: 'google_drive', operation: 'label', artifacts: [{ sourceType: 'google_drive', sourceItemId: 'f2' }], destination: 'taxes', idempotencyKey: 'label-1' });
  const duplicateCreate = await service.createSourceMutationOperation({ userId: 'u1', sourceType: 'google_drive', operation: 'label', artifacts: [{ sourceType: 'google_drive', sourceItemId: 'f2' }], destination: 'taxes', idempotencyKey: 'label-1' });
  assert.equal(duplicateCreate.duplicate, true);
  await service.approveAndExecute(first.operation.id);
  const duplicateExecute = await service.approveAndExecute(first.operation.id);
  assert.equal(duplicateExecute.duplicate, true);
  assert.equal(driveCalls.length, 1);
});

test('provider capability revocation fails closed before source mutation', async () => {
  const store = createMemoryArchiveStore();
  const adapter = createSourceOrganizationAdapter({ sourceType: 'google_drive', capabilities: ['move'] });
  const service = createArchiveService({ store, adapters: [adapter], idFactory: () => 'op-1' });
  const created = await service.createSourceMutationOperation({ userId: 'u1', sourceType: 'google_drive', operation: 'move', artifacts: [], idempotencyKey: 'revoked' });
  adapter.supports = () => false;
  await assert.rejects(service.approveAndExecute(created.operation.id), (error) => error.code === 'CAPABILITY_REVOKED');
});
