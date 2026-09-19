import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createAutomationService, createFileAutomationStore, createMemoryAutomationStore, createNaiaAutomationDispatcher } from '../../src/product/automations.mjs';
import { createFixtureMediaCleanupAdapter, createMediaCleanupService, proposeMediaCleanup, registerMediaCleanupCapability } from '../../src/product/media-cleanup.mjs';
import { createFileMediaCleanupPolicyStore, createMediaCleanupPolicyService, registerMediaCleanupPolicyCapability } from '../../src/product/media-cleanup-policies.mjs';

function fixture({inventoryRows=null,adapter=null,policyStore=null,automationStore=null}={}){
  const naia=createNaiaService(createInMemoryPorts());
  const automations=createAutomationService({store:automationStore??createMemoryAutomationStore(),dispatcher:createNaiaAutomationDispatcher(naia),now:()=> '2026-09-19T15:00:00Z'});
  const rows=inventoryRows??[
    {id:'a',sourceType:'whatsapp',categories:['MEME'],duplicateKinds:['EXACT'],sizeBytes:20,createdAt:'2026-08-01T00:00:00Z',modifiedAt:'1',stableSourceId:'content://a'},
    {id:'b',sourceType:'camera',categories:['SELFIE'],duplicateKinds:[],sizeBytes:5,createdAt:'2026-09-18T00:00:00Z',modifiedAt:'1',stableSourceId:'content://b'},
  ];
  const cleanupAdapter=adapter??createFixtureMediaCleanupAdapter({items:rows});
  const cleanup=createMediaCleanupService({adapter:cleanupAdapter,idFactory:(()=>{let i=0;return()=>`cleanup-${++i}`;})(),now:()=> '2026-09-19T15:00:00Z'});
  registerMediaCleanupCapability(naia,{service:cleanup});
  const inventory={async list(){return rows.map(row=>structuredClone(row));}};
  let id=0;
  const policies=createMediaCleanupPolicyService({store:policyStore??undefined,automationService:automations,inventory,cleanupService:cleanup,idFactory:()=>`policy-${++id}`,now:()=> '2026-09-19T15:00:00Z'});
  registerMediaCleanupPolicyCapability(naia,{service:policies});
  return {naia,automations,policies,cleanup,cleanupAdapter,rows};
}

test('scheduled dry-run produces candidates without deleting anything',async()=>{
  const f=fixture();
  const policy=await f.policies.create({userId:'u1',name:'Old WhatsApp memes',schedule:'0 9 * * *',timezone:'America/Sao_Paulo',filters:{sourceType:'whatsapp',category:'MEME',minAgeDays:30,minSizeBytes:10},mode:'DRY_RUN'});
  const triggered=await f.automations.trigger(policy.automationId,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'2026-09-20'}});
  assert.equal(triggered.status,'DISPATCHED');
  assert.equal(triggered.result.objective.status,'COMPLETED');
  const [run]=await f.policies.runs(policy.id);
  assert.equal(run.status,'DRY_RUN');
  assert.deepEqual(run.candidateIds,['a']);
  assert.equal(f.cleanupAdapter.calls().length,0);
});

test('duplicate scheduled delivery does not create a second run',async()=>{
  const f=fixture();
  const policy=await f.policies.create({userId:'u1',name:'Duplicates',schedule:'0 9 * * *',filters:{duplicateKind:'EXACT'},mode:'DRY_RUN'});
  const first=await f.automations.trigger(policy.automationId,{deliveryId:'same-tick',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'d1'}});
  const duplicate=await f.automations.trigger(policy.automationId,{deliveryId:'same-tick',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'d1'}});
  assert.equal(first.status,'DISPATCHED');
  assert.equal(duplicate.status,'DUPLICATE');
  assert.equal((await f.policies.runs(policy.id)).length,1);
});

test('review mode prepares cleanup action but destructive mutation still requires separate confirmation and approval',async()=>{
  const f=fixture();
  const policy=await f.policies.create({userId:'u1',name:'Review memes',schedule:'0 9 * * *',filters:{category:'MEME'},mode:'REVIEW'});
  await f.automations.trigger(policy.automationId,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'d1'}});
  const [run]=await f.policies.runs(policy.id);
  assert.equal(run.status,'AWAITING_REVIEW');
  assert.ok(run.cleanupActionId);
  assert.equal(f.cleanupAdapter.calls().length,0);
  const action=await f.cleanup.getAction(run.cleanupActionId);
  const proposed=await proposeMediaCleanup(f.naia,action);
  assert.equal(proposed.objective.status,'WAITING_CONFIRMATION');
  await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);
  assert.equal(f.cleanupAdapter.calls().length,0);
  const completed=await f.naia.approve(proposed.objective.id,'media.cleanup.commit');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(f.cleanupAdapter.calls().length,1);
});

test('stale candidate after scheduled review is skipped at destructive execution',async()=>{
  const rows=[{id:'a',sourceType:'whatsapp',categories:['MEME'],sizeBytes:20,createdAt:'2026-08-01T00:00:00Z',modifiedAt:'1',stableSourceId:'content://a'}];
  let current={...rows[0]};const calls=[];
  const adapter={platform:'android',supports:{trash:true,delete:true},async inspect(){return {...current};},async mutate(input){calls.push(input);return {status:'TRASHED'};}};
  const f=fixture({inventoryRows:rows,adapter});
  const policy=await f.policies.create({userId:'u1',name:'Review',schedule:'0 9 * * *',filters:{category:'MEME'},mode:'REVIEW'});
  await f.automations.trigger(policy.automationId,{deliveryId:'tick',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'d1'}});
  const [run]=await f.policies.runs(policy.id);const action=await f.cleanup.getAction(run.cleanupActionId);
  current={...current,modifiedAt:'2'};
  const proposed=await proposeMediaCleanup(f.naia,action);await f.naia.confirm(proposed.objective.id,proposed.confirmation.id);await f.naia.approve(proposed.objective.id,'media.cleanup.commit');
  const saved=await f.cleanup.getAction(action.id);
  assert.equal(saved.results.a.status,'SKIPPED');assert.equal(saved.results.a.reason,'STALE_REFERENCE');assert.equal(calls.length,0);
});

test('pause resume and delete control the underlying scheduled automation',async()=>{
  const f=fixture();
  const policy=await f.policies.create({userId:'u1',name:'Policy',schedule:'0 9 * * *',mode:'DRY_RUN'});
  await f.policies.pause(policy.id);
  assert.equal((await f.automations.trigger(policy.automationId,{deliveryId:'p1',trigger:{kind:'SCHEDULE'}})).status,'DISABLED');
  await f.policies.resume(policy.id);
  assert.equal((await f.automations.trigger(policy.automationId,{deliveryId:'p2',trigger:{kind:'SCHEDULE'}})).status,'DISPATCHED');
  await f.policies.delete(policy.id);
  assert.equal((await f.policies.get(policy.id)).status,'DELETED');
});

test('platform-unavailable cleanup becomes BLOCKED review run instead of fake success',async()=>{
  const rows=[{id:'a',categories:['MEME'],sizeBytes:10,createdAt:'2026-08-01T00:00:00Z',modifiedAt:'1'}];
  const adapter=createFixtureMediaCleanupAdapter({platform:'web',items:rows,supportsTrash:false});adapter.supports.delete=false;
  const f=fixture({inventoryRows:rows,adapter});
  const policy=await f.policies.create({userId:'u1',name:'Web',schedule:'0 9 * * *',filters:{category:'MEME'},mode:'REVIEW'});
  await f.automations.trigger(policy.automationId,{deliveryId:'tick',trigger:{kind:'SCHEDULE'}});
  const [run]=await f.policies.runs(policy.id);
  assert.equal(run.status,'BLOCKED');assert.equal(run.error.code,'CAPABILITY_UNAVAILABLE');assert.equal(f.cleanupAdapter.calls().length,0);
});

test('policy and run history survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-cleanup-policy-'));
  try{
    const automationStore=createFileAutomationStore({rootDir:dir});
    const policyStore=createFileMediaCleanupPolicyStore({rootDir:dir});
    const f=fixture({policyStore,automationStore});
    const policy=await f.policies.create({userId:'u1',name:'Persistent',schedule:'0 9 * * *',mode:'DRY_RUN'});
    await f.automations.trigger(policy.automationId,{deliveryId:'tick',trigger:{kind:'SCHEDULE'},payload:{occurrenceKey:'d1'}});
    const secondStore=createFileMediaCleanupPolicyStore({rootDir:dir});
    const saved=await secondStore.getPolicy(policy.id);const runs=await secondStore.listRuns(policy.id);
    assert.equal(saved.name,'Persistent');assert.equal(runs.length,1);assert.equal(runs[0].occurrenceKey,'d1');
  }finally{await rm(dir,{recursive:true,force:true});}
});
