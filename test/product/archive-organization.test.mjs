import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createArchiveService, createFileArchiveStore, createMemoryArchiveStore, createSourceOrganizationAdapter, proposeArchiveMutation, registerArchiveCapabilities } from '../../src/product/archive-organization.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

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

test('file-backed archive preserves virtual collections and prepared operations across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naia-archive-'));
  try {
    const drive = createSourceOrganizationAdapter({ sourceType:'google_drive', capabilities:['move'] });
    const first = createArchiveService({ store:createFileArchiveStore({ rootDir:dir }), adapters:[drive], idFactory:(()=>{let i=0;return()=>`id-${++i}`;})(), now:()=> '2026-09-19T12:00:00Z' });
    const collection = await first.createCollection({ userId:'u1', name:'Taxes' });
    await first.addArtifact(collection.id,{ sourceType:'google_drive', sourceItemId:'f1' });
    const prepared = await first.createSourceMutationOperation({ userId:'u1', sourceType:'google_drive', operation:'move', artifacts:[{sourceType:'google_drive',sourceItemId:'f1'}], destination:'folder-1', idempotencyKey:'move-1' });
    const second = createArchiveService({ store:createFileArchiveStore({ rootDir:dir }), adapters:[drive] });
    assert.equal((await second.getCollection?.(collection.id)) ?? null, null);
    const duplicate = await second.createSourceMutationOperation({ userId:'u1', sourceType:'google_drive', operation:'move', artifacts:[{sourceType:'google_drive',sourceItemId:'f1'}], destination:'folder-1', idempotencyKey:'move-1' });
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.operation.id,prepared.operation.id);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('prepared archive source mutation enters normal runtime WAITING_APPROVAL before external write', async () => {
  const store=createMemoryArchiveStore();
  const calls=[];
  const drive=createSourceOrganizationAdapter({sourceType:'google_drive',capabilities:['move'],executor:async(operation,input)=>{calls.push({operation,input});return {ok:true};}});
  const service=createArchiveService({store,adapters:[drive],idFactory:()=> 'op-1'});
  const prepared=await service.createSourceMutationOperation({userId:'u1',sourceType:'google_drive',operation:'move',artifacts:[{sourceType:'google_drive',sourceItemId:'f1'}],destination:'folder-1',idempotencyKey:'move-1'});
  const naia=createNaiaService(createInMemoryPorts());
  registerArchiveCapabilities(naia,{service});
  const pending=await proposeArchiveMutation(naia,prepared);
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  assert.equal(calls.length,0);
  const completed=await naia.approve(pending.objective.id,'archive.execute');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(calls.length,1);
});

test('archive fingerprint mismatch fails closed before source mutation', async () => {
  let calls=0;
  const drive=createSourceOrganizationAdapter({sourceType:'google_drive',capabilities:['move'],executor:async()=>{calls+=1;return {ok:true};}});
  const service=createArchiveService({adapters:[drive],idFactory:()=> 'op-1'});
  const prepared=await service.createSourceMutationOperation({userId:'u1',sourceType:'google_drive',operation:'move',artifacts:[{sourceType:'google_drive',sourceItemId:'f1'}],destination:'folder-1',idempotencyKey:'move-1'});
  await assert.rejects(service.executePrepared(prepared.operation.id,'wrong-fingerprint'),(error)=>error.code==='ACTION_STALE');
  assert.equal(calls,0);
});

test('runtime-approved archive execution remains idempotent on duplicate objective retry', async () => {
  let calls=0;
  const drive=createSourceOrganizationAdapter({sourceType:'google_drive',capabilities:['label'],executor:async()=>{calls+=1;return {ok:true};}});
  const service=createArchiveService({adapters:[drive],idFactory:()=> 'op-1'});
  const prepared=await service.createSourceMutationOperation({userId:'u1',sourceType:'google_drive',operation:'label',artifacts:[{sourceType:'google_drive',sourceItemId:'f1'}],destination:'taxes',idempotencyKey:'label-1'});
  const first=await service.executePrepared(prepared.operation.id,prepared.operation.fingerprint);
  const duplicate=await service.executePrepared(prepared.operation.id,prepared.operation.fingerprint);
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(calls,1);
});
