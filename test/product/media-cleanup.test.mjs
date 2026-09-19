import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFileMediaCleanupStore, createFixtureMediaCleanupAdapter, createMediaCleanupService, proposeMediaCleanup, registerMediaCleanupCapability } from '../../src/product/media-cleanup.mjs';

function items(){return [
  {id:'a',stableSourceId:'content://a',sizeBytes:10,modifiedAt:'1'},
  {id:'b',stableSourceId:'content://b',sizeBytes:20,modifiedAt:'1'},
];}

test('no media mutation occurs before confirmation and runtime approval',async()=>{
  const adapter=createFixtureMediaCleanupAdapter({items:items(),supportsTrash:true});
  const service=createMediaCleanupService({adapter,idFactory:()=> 'action-1'});
  const action=await service.prepare({userId:'u1',items:items()});
  const naia=createNaiaService(createInMemoryPorts());registerMediaCleanupCapability(naia,{service});
  const proposed=await proposeMediaCleanup(naia,action);
  assert.equal(proposed.objective.status,'WAITING_CONFIRMATION');
  assert.equal(adapter.calls().length,0);
  const waitingApproval=await naia.confirm(proposed.objective.id,proposed.confirmation.id);
  assert.equal(waitingApproval.objective.status,'WAITING_APPROVAL');
  assert.equal(adapter.calls().length,0);
  const completed=await naia.approve(proposed.objective.id,'media.cleanup.commit');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(adapter.calls().length,2);
  assert.ok(adapter.calls().every(call=>call.mode==='trash'));
});

test('direct cleanup execution fails closed without approval',async()=>{
  const adapter=createFixtureMediaCleanupAdapter({items:items()});
  const service=createMediaCleanupService({adapter,idFactory:()=> 'action-1'});
  const action=await service.prepare({userId:'u1',items:items()});
  await assert.rejects(service.execute({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'x'}),(e)=>e.code==='APPROVAL_REQUIRED');
  assert.equal(adapter.calls().length,0);
});

test('stale item reference is skipped without deleting changed media',async()=>{
  const prepared=items();
  const adapter=createFixtureMediaCleanupAdapter({items:[{...prepared[0],modifiedAt:'2'},prepared[1]]});
  const service=createMediaCleanupService({adapter,idFactory:()=> 'action-1'});
  const action=await service.prepare({userId:'u1',items:prepared});
  const naia=createNaiaService(createInMemoryPorts());registerMediaCleanupCapability(naia,{service});
  const proposed=await proposeMediaCleanup(naia,action);await naia.confirm(proposed.objective.id,proposed.confirmation.id);await naia.approve(proposed.objective.id,'media.cleanup.commit');
  const saved=await service.getAction(action.id);
  assert.equal(saved.results.a.status,'SKIPPED');
  assert.equal(saved.results.a.reason,'STALE_REFERENCE');
  assert.equal(saved.results.b.status,'TRASHED');
  assert.deepEqual(adapter.calls().map(c=>c.id),['b']);
});

test('partial retry resumes only retryable failed items and never repeats successful deletions',async()=>{
  let fail=true;
  const current=new Map(items().map(i=>[i.id,{...i}]));const calls=[];
  const adapter={platform:'android',supports:{trash:true,delete:true},
    async inspect(id){return current.get(id)??null;},
    async mutate({id,mode,idempotencyKey}){calls.push({id,mode,idempotencyKey});if(id==='b'&&fail){const e=new Error('busy');e.code='BUSY';e.retryable=true;throw e;}current.delete(id);return {id,status:'TRASHED'};}
  };
  const service=createMediaCleanupService({adapter,idFactory:()=> 'action-1'});
  const action=await service.prepare({userId:'u1',items:items()});
  const first=await service.executeRuntimeApproved({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'run'});
  assert.equal(first.status,'PARTIAL');
  assert.deepEqual(calls.map(c=>c.id),['a','b']);
  fail=false;
  const second=await service.executeRuntimeApproved({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'run'});
  assert.equal(second.status,'COMPLETED');
  assert.deepEqual(calls.map(c=>c.id),['a','b','b']);
});

test('unsupported destructive platform fails before approval action is created',async()=>{
  const adapter=createFixtureMediaCleanupAdapter({platform:'web',items:items(),supportsTrash:false});
  adapter.supports.delete=false;
  const service=createMediaCleanupService({adapter});
  await assert.rejects(service.prepare({userId:'u1',items:items()}),(e)=>e.code==='CAPABILITY_UNAVAILABLE');
});

test('file-backed cleanup results survive restart and successful items remain idempotent',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-cleanup-'));
  try{
    const adapter=createFixtureMediaCleanupAdapter({items:items()});
    const first=createMediaCleanupService({store:createFileMediaCleanupStore({rootDir:dir}),adapter,idFactory:()=> 'action-1'});
    const action=await first.prepare({userId:'u1',items:items()});
    const result=await first.executeRuntimeApproved({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'run'});
    assert.equal(result.status,'COMPLETED');
    const callsBefore=adapter.calls().length;
    const second=createMediaCleanupService({store:createFileMediaCleanupStore({rootDir:dir}),adapter});
    const repeated=await second.executeRuntimeApproved({actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:'run'});
    assert.equal(repeated.status,'COMPLETED');
    assert.equal(adapter.calls().length,callsBefore);
  }finally{await rm(dir,{recursive:true,force:true});}
});
