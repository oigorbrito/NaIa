import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createBackupAwareCleanupPolicy, createFileMediaBackupStore, createFixtureMediaBackupProvider, createMediaBackupService } from '../../src/product/media-backup.mjs';
import { createFixtureMediaCleanupAdapter, createMediaCleanupService } from '../../src/product/media-cleanup.mjs';

test('backup metadata records provider state and observation timestamp',async()=>{
  const provider=createFixtureMediaBackupProvider({name:'cloud',states:{a:'BACKED_UP',b:'NOT_BACKED_UP'}});
  const service=createMediaBackupService({provider,now:()=> '2026-09-19T15:00:00Z'});
  const rows=await service.refresh([{id:'a'},{id:'b'}]);
  assert.deepEqual(rows.map(r=>r.state),['BACKED_UP','NOT_BACKED_UP']);
  assert.ok(rows.every(r=>r.provider==='cloud'&&r.observedAt==='2026-09-19T15:00:00Z'));
});

test('provider outage degrades every requested item to explicit PROVIDER_UNAVAILABLE',async()=>{
  const provider=createFixtureMediaBackupProvider({name:'cloud',fail:{code:'TIMEOUT',retryable:true}});
  const service=createMediaBackupService({provider,now:()=> '2026-09-19T15:00:00Z'});
  const rows=await service.refresh([{id:'a'},{id:'b'}]);
  assert.deepEqual(rows.map(r=>r.state),['PROVIDER_UNAVAILABLE','PROVIDER_UNAVAILABLE']);
  assert.ok(rows.every(r=>r.errorCode==='TIMEOUT'));
});

test('stale backed-up metadata becomes UNKNOWN rather than implicitly safe',async()=>{
  let clock='2026-09-19T15:00:00Z';
  const provider=createFixtureMediaBackupProvider({states:{a:'BACKED_UP'}});
  const service=createMediaBackupService({provider,now:()=>clock});
  await service.refresh([{id:'a'}]);
  clock='2026-09-21T15:00:00Z';
  const state=await service.state('a',{maxAgeMs:24*60*60*1000,asOf:clock});
  assert.equal(state.state,'UNKNOWN');
  assert.equal(state.stale,true);
  assert.equal(state.previousState,'BACKED_UP');
});

test('cleanup policy allows only fresh BACKED_UP items when required',async()=>{
  const provider=createFixtureMediaBackupProvider({states:{a:'BACKED_UP',b:'NOT_BACKED_UP',c:'UNKNOWN'}});
  const backup=createMediaBackupService({provider,now:()=> '2026-09-19T15:00:00Z'});
  await backup.refresh([{id:'a'},{id:'b'},{id:'c'}]);
  const policy=createBackupAwareCleanupPolicy({backupService:backup,requireBackedUp:true,maxAgeMs:24*60*60*1000});
  assert.equal((await policy.validate({items:[{id:'a'}]})).allowed,true);
  const blocked=await policy.validate({items:[{id:'a'},{id:'b'},{id:'c'}]});
  assert.equal(blocked.allowed,false);
  assert.deepEqual(blocked.reasons.map(r=>[r.itemId,r.state]),[['b','NOT_BACKED_UP'],['c','UNKNOWN']]);
});

test('backup-aware cleanup blocks preparation before any destructive action exists',async()=>{
  const items=[{id:'a',stableSourceId:'content://a',sizeBytes:10,modifiedAt:'1'}];
  const provider=createFixtureMediaBackupProvider({states:{a:'UNKNOWN'}});
  const backup=createMediaBackupService({provider});await backup.refresh(items);
  const policy=createBackupAwareCleanupPolicy({backupService:backup,requireBackedUp:true});
  const adapter=createFixtureMediaCleanupAdapter({items});
  const cleanup=createMediaCleanupService({adapter,safetyPolicy:policy});
  await assert.rejects(cleanup.prepare({userId:'u1',items}),(e)=>e.code==='BACKUP_SAFETY_BLOCKED'&&e.reasons[0].state==='UNKNOWN');
  assert.equal(adapter.calls().length,0);
});

test('backup requirement can be disabled explicitly without treating unknown as backed up',async()=>{
  const backup=createMediaBackupService({provider:createFixtureMediaBackupProvider({states:{a:'UNKNOWN'}})});
  await backup.refresh([{id:'a'}]);
  const policy=createBackupAwareCleanupPolicy({backupService:backup,requireBackedUp:false});
  const decision=await policy.validate({items:[{id:'a'}]});
  assert.equal(decision.allowed,true);
});

test('backup state survives file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-backup-'));
  try{
    const provider=createFixtureMediaBackupProvider({name:'cloud',states:{a:'BACKED_UP'}});
    const first=createMediaBackupService({provider,store:createFileMediaBackupStore({rootDir:dir}),now:()=> '2026-09-19T15:00:00Z'});
    await first.refresh([{id:'a'}]);
    const second=createMediaBackupService({provider,store:createFileMediaBackupStore({rootDir:dir}),now:()=> '2026-09-19T16:00:00Z'});
    const state=await second.state('a',{maxAgeMs:24*60*60*1000});
    assert.equal(state.state,'BACKED_UP');assert.equal(state.stale,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
