import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createFileHistoryStore, createHistoryService, createMemoryHistoryStore } from '../../src/product/history.mjs';

function snapshot({id,title='Objective',status='COMPLETED',updatedAt,tool='email.send',provider='gmail',secret=false,conversation=[]}={}){
  return {
    objective:{id,title,description:'desc',status,createdAt:updatedAt,updatedAt,approvals:tool? [tool]:[],confirmations:[]},
    plan:{intent:'TEST',steps:[{id:id+':1',kind:'EXECUTE',status:'COMPLETED',action:tool?{tool,risk:tool.includes('send')?'EXTERNAL_WRITE':'READ_ONLY'}:null}]},
    evidence:[{type:'STEP_EXECUTED',objectiveId:id,tool,provider,ok:true,output:secret?{authorization:'Bearer hidden',apiToken:'hidden',result:'ok'}:{result:'ok'},at:updatedAt}],
    conversation,
  };
}

test('PRO retains history older than FREE window and FREE does not',async()=>{
  let clock=new Date('2026-09-19T00:00:00Z');
  const entitlements=createEntitlementService({now:()=>clock});
  await entitlements.setSubscription({userId:'u1',planId:'PRO',state:'ACTIVE'});
  const store=createMemoryHistoryStore();
  const history=createHistoryService({store,entitlements,now:()=>clock,idFactory:(()=>{let i=0;return()=>`h${++i}`;})()});
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'old',updatedAt:'2026-07-01T00:00:00Z'})});
  assert.equal((await history.search({userId:'u1'})).items.length,1);
  await entitlements.setSubscription({userId:'u1',planId:'FREE',state:'ACTIVE'});
  assert.equal((await history.search({userId:'u1'})).items.length,0);
});

test('tier downgrade pruning deletes records outside new retention window',async()=>{
  const clock=new Date('2026-09-19T00:00:00Z');
  const entitlements=createEntitlementService({now:()=>clock});
  await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const store=createMemoryHistoryStore();
  const history=createHistoryService({store,entitlements,now:()=>clock,idFactory:(()=>{let i=0;return()=>`h${++i}`;})()});
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'old',updatedAt:'2026-07-01T00:00:00Z'})});
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'new',updatedAt:'2026-09-10T00:00:00Z'})});
  await entitlements.setSubscription({userId:'u1',planId:'FREE'});
  const result=await history.applyRetention('u1');
  assert.equal(result.deleted,1);
  assert.equal(result.remaining,1);
  assert.equal((await history.search({userId:'u1'})).items[0].objectiveId,'new');
});

test('ULTRA retention is unlimited by default',async()=>{
  const clock=new Date('2026-09-19T00:00:00Z');
  const entitlements=createEntitlementService({now:()=>clock});
  await entitlements.setSubscription({userId:'u1',planId:'ULTRA'});
  const history=createHistoryService({entitlements,now:()=>clock,idFactory:()=> 'h1'});
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'ancient',updatedAt:'2020-01-01T00:00:00Z'})});
  const result=await history.search({userId:'u1'});
  assert.equal(result.retentionDays,null);
  assert.equal(result.items.length,1);
});

test('search filters deterministically by query date capability provider and status',async()=>{
  const clock=new Date('2026-09-19T00:00:00Z');
  const entitlements=createEntitlementService({now:()=>clock});await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const history=createHistoryService({entitlements,now:()=>clock,idFactory:(()=>{let i=0;return()=>`h${++i}`;})()});
  await history.ingestObjective({userId:'u1',provider:'gmail',snapshot:snapshot({id:'a',title:'Send budget',updatedAt:'2026-09-18T10:00:00Z',tool:'email.send',provider:'gmail',conversation:[{role:'user',text:'budget for Maria'}]})});
  await history.ingestObjective({userId:'u1',provider:'calendar',snapshot:snapshot({id:'b',title:'List meetings',updatedAt:'2026-09-17T10:00:00Z',tool:'calendar.list',provider:'google-calendar'})});
  const result=await history.search({userId:'u1',query:'Maria',from:'2026-09-18T00:00:00Z',to:'2026-09-19T00:00:00Z',capability:'email.send',provider:'gmail',status:'COMPLETED'});
  assert.deepEqual(result.items.map(r=>r.objectiveId),['a']);
});

test('deleted records disappear from search and export',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const history=createHistoryService({entitlements,idFactory:()=> 'h1'});
  const row=await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'a',updatedAt:new Date().toISOString()})});
  assert.equal((await history.delete({userId:'u1',id:row.id})).deleted,true);
  assert.equal((await history.search({userId:'u1'})).items.length,0);
  assert.equal((await history.export('u1')).items.length,0);
});

test('history sanitizes credential-like fields from evidence and export',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const history=createHistoryService({entitlements,idFactory:()=> 'h1'});
  const row=await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'a',updatedAt:new Date().toISOString(),secret:true})});
  const encoded=JSON.stringify(row);
  assert.equal(encoded.includes('Bearer hidden'),false);
  assert.equal(encoded.includes('apiToken'),false);
  const exported=JSON.stringify(await history.export('u1'));
  assert.equal(exported.includes('hidden'),false);
});

test('file history store survives restart in a dedicated index file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-history-'));
  try{
    const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
    const store=createFileHistoryStore({rootDir:dir});
    const first=createHistoryService({store,entitlements,idFactory:()=> 'h1'});
    await first.ingestObjective({userId:'u1',snapshot:snapshot({id:'a',updatedAt:new Date().toISOString()})});
    const second=createHistoryService({store:createFileHistoryStore({rootDir:dir}),entitlements});
    assert.equal((await second.search({userId:'u1'})).items.length,1);
    assert.match(store.path,/history-index\.json$/);
    assert.doesNotMatch(store.path,/objectives|evidence/);
    const text=await readFile(store.path,'utf8');assert.match(text,/objectiveId/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('cross-user history deletion and search are isolated',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});await entitlements.setSubscription({userId:'u2',planId:'PRO'});
  const history=createHistoryService({entitlements,idFactory:()=> 'h1'});
  const row=await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'a',updatedAt:new Date().toISOString()})});
  assert.equal((await history.search({userId:'u2'})).items.length,0);
  assert.equal((await history.delete({userId:'u2',id:row.id})).deleted,false);
  assert.equal((await history.search({userId:'u1'})).items.length,1);
});
