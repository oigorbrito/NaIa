import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import {
  createFilePersonalMemoryStore,
  createMemoryPersonalMemoryStore,
  createPersonalMemoryService,
  registerPersonalMemoryCapabilities,
} from '../../src/product/personal-memory.mjs';

test('preference persists separately and is retrievable by exact key',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-memory-'));
  try{
    const store=createFilePersonalMemoryStore({rootDir:dir});
    const service=createPersonalMemoryService({store,idFactory:()=> 'mem-1',now:()=> '2026-09-19T15:00:00Z'});
    await service.put({userId:'u1',type:'PREFERENCE',key:'briefing.language',value:'pt-BR',source:{kind:'EXPLICIT_USER'}});
    const restarted=createPersonalMemoryService({store:createFilePersonalMemoryStore({rootDir:dir})});
    const record=await restarted.getByKey({userId:'u1',type:'PREFERENCE',key:'briefing.language'});
    assert.equal(record.value,'pt-BR');
    const persisted=JSON.parse(await readFile(join(dir,'personal-memory.json'),'utf8'));
    assert.equal(persisted['mem-1'].key,'briefing.language');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('memory storage is distinct from operational objective/evidence files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-memory-isolation-'));
  try{
    const store=createFilePersonalMemoryStore({rootDir:dir});
    const service=createPersonalMemoryService({store,idFactory:()=> 'm1'});
    await service.put({userId:'u1',type:'FACT',key:'favorite.color',value:'green',source:{kind:'EXPLICIT_USER'}});
    assert.match(store.path,/personal-memory\.json$/);
    assert.doesNotMatch(store.path,/objectives|plans|evidence/);
    const text=await readFile(store.path,'utf8');
    assert.match(text,/favorite\.color/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('people/place records support aliases and attribute lookup',async()=>{
  const service=createPersonalMemoryService({idFactory:(()=>{let i=0;return()=>`m${++i}`;})()});
  await service.put({userId:'u1',type:'PERSON',key:'person.maria',value:{name:'Maria Silva'},aliases:['Mari'],attributes:{relationship:'sister'},source:{kind:'EXPLICIT_USER'}});
  await service.put({userId:'u1',type:'PLACE',key:'place.home',value:{label:'Home'},aliases:['casa'],attributes:{city:'Porto Alegre'},source:{kind:'EXPLICIT_USER'}});
  assert.equal((await service.search({userId:'u1',query:'Mari'}))[0].key,'person.maria');
  assert.equal((await service.search({userId:'u1',type:'PLACE',attributes:{city:'Porto Alegre'}}))[0].key,'place.home');
});

test('record update preserves identity and creation timestamp while updating value/provenance timestamp',async()=>{
  let clock='2026-09-19T15:00:00Z';
  const service=createPersonalMemoryService({idFactory:()=> 'm1',now:()=>clock});
  const first=await service.put({userId:'u1',type:'PREFERENCE',key:'shopping.strategy',value:'SINGLE_STORE',source:{kind:'EXPLICIT_USER'}});
  clock='2026-09-20T15:00:00Z';
  const updated=await service.put({...first,value:'SPLIT_COMPARE_ONLY',source:{kind:'EXPLICIT_USER'}});
  assert.equal(updated.id,first.id);
  assert.equal(updated.createdAt,first.createdAt);
  assert.equal(updated.updatedAt,'2026-09-20T15:00:00Z');
  assert.equal(updated.value,'SPLIT_COMPARE_ONLY');
});

test('normal and sensitive deletion are explicit, with extra confirmation for sensitive records',async()=>{
  const service=createPersonalMemoryService({idFactory:(()=>{let i=0;return()=>`m${++i}`;})()});
  const normal=await service.put({userId:'u1',type:'FACT',key:'shoe.size',value:42,source:{kind:'EXPLICIT_USER'}});
  assert.equal((await service.delete({userId:'u1',id:normal.id})).deleted,true);
  const sensitive=await service.put({userId:'u1',type:'FACT',key:'private.note',value:'personal',sensitivity:'SENSITIVE',explicitConsent:true,source:{kind:'EXPLICIT_USER'}});
  await assert.rejects(service.delete({userId:'u1',id:sensitive.id}),(error)=>error.code==='SENSITIVE_MEMORY_DELETE_CONFIRMATION_REQUIRED');
  assert.equal((await service.delete({userId:'u1',id:sensitive.id,confirmSensitive:true})).deleted,true);
});

test('sensitive memory cannot be inferred/connector-written without explicit user consent',async()=>{
  const service=createPersonalMemoryService();
  await assert.rejects(
    service.put({userId:'u1',type:'FACT',key:'health.preference',value:'x',sensitivity:'SENSITIVE',source:{kind:'CONNECTED_SOURCE'}}),
    (error)=>error.code==='SENSITIVE_MEMORY_CONSENT_REQUIRED',
  );
  await assert.rejects(
    service.put({userId:'u1',type:'FACT',key:'private',value:'x',sensitivity:'SENSITIVE',source:{kind:'EXPLICIT_USER'},explicitConsent:false}),
    (error)=>error.code==='SENSITIVE_MEMORY_CONSENT_REQUIRED',
  );
});

test('credential-like fields are never accepted as personal memory',async()=>{
  const service=createPersonalMemoryService();
  await assert.rejects(
    service.put({userId:'u1',type:'FACT',key:'account',value:{apiToken:'secret'},source:{kind:'EXPLICIT_USER'}}),
    (error)=>error.code==='FORBIDDEN_MEMORY_FIELD',
  );
});

test('cross-user reads/search/delete are isolated',async()=>{
  const store=createMemoryPersonalMemoryStore();
  const service=createPersonalMemoryService({store,idFactory:()=> 'm1'});
  const row=await service.put({userId:'u1',type:'PREFERENCE',key:'language',value:'pt-BR',source:{kind:'EXPLICIT_USER'}});
  assert.equal(await service.get({userId:'u2',id:row.id}),null);
  assert.deepEqual(await service.search({userId:'u2',query:'language'}),[]);
  assert.equal((await service.delete({userId:'u2',id:row.id})).deleted,false);
  assert.equal((await service.get({userId:'u1',id:row.id})).value,'pt-BR');
});

test('stored preference can be consumed by a later supported workflow',async()=>{
  const service=createPersonalMemoryService({idFactory:()=> 'm1'});
  await service.put({userId:'u1',type:'PREFERENCE',key:'briefing.language',value:'pt-BR',source:{kind:'EXPLICIT_USER'}});
  const preference=await service.getByKey({userId:'u1',type:'PREFERENCE',key:'briefing.language'});
  const laterBriefingOptions={language:preference?.value??'en-US'};
  assert.deepEqual(laterBriefingOptions,{language:'pt-BR'});
});

test('memory capabilities remain policy-gated in runtime',async()=>{
  const service=createPersonalMemoryService({idFactory:()=> 'm1'});
  const naia=createNaiaService(createInMemoryPorts());
  registerPersonalMemoryCapabilities(naia,{service,userId:'u1'});
  const write=await naia.pursueAction({title:'Remember preference',action:{tool:'memory.put',input:{type:'PREFERENCE',key:'language',value:'pt-BR',source:{kind:'EXPLICIT_USER'}},risk:'LOCAL_WRITE',requiresApproval:true}});
  assert.equal(write.objective.status,'WAITING_APPROVAL');
  await naia.approve(write.objective.id,'memory.put');
  const read=await naia.pursueAction({title:'Read memory',action:{tool:'memory.search',input:{query:'language'},risk:'SENSITIVE',requiresApproval:true}});
  assert.equal(read.objective.status,'WAITING_APPROVAL');
  const completed=await naia.approve(read.objective.id,'memory.search');
  assert.equal(completed.objective.status,'COMPLETED');
});
