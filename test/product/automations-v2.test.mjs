import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import {
  createAutomationService,
  createFileAutomationStore,
  createMemoryAutomationStore,
  createNaiaAutomationDispatcher,
  evaluateAutomationCondition,
} from '../../src/product/automations.mjs';
import { createEntitlementService, createPlanCatalog } from '../../src/product/entitlements.mjs';
import { createQuotaPolicy, createUsageMeter } from '../../src/product/metering.mjs';

function fixture(options={}){
  const naia=createNaiaService(createInMemoryPorts());
  const store=options.store??createMemoryAutomationStore();
  const dispatcher=createNaiaAutomationDispatcher(naia);
  const service=createAutomationService({store,dispatcher,...options});
  return {naia,store,service};
}

test('condition evaluator supports nested ALL/ANY and comparison operators',()=>{
  const condition={op:'ALL',conditions:[
    {op:'GTE',path:'price',value:10},
    {op:'ANY',conditions:[{op:'EQ',path:'state',value:'OPEN'},{op:'EXISTS',path:'fallback'}]},
  ]};
  assert.equal(evaluateAutomationCondition(condition,{price:12,state:'OPEN'}),true);
  assert.equal(evaluateAutomationCondition(condition,{price:9,state:'OPEN'}),false);
});

test('scheduled automation dispatches one read-only action and duplicate delivery is suppressed',async()=>{
  const {service}=fixture();
  const automation=await service.create({userId:'u1',name:'daily echo',trigger:{kind:'SCHEDULE',schedule:'0 9 * * *',timezone:'America/Sao_Paulo'},action:{tool:'text.echo',input:{text:'daily'},risk:'READ_ONLY'}});
  const first=await service.trigger(automation.id,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{at:'09:00'}});
  assert.equal(first.status,'DISPATCHED');
  assert.equal(first.result.objective.status,'COMPLETED');
  const duplicate=await service.trigger(automation.id,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{at:'09:00'}});
  assert.equal(duplicate.status,'DUPLICATE');
  assert.equal(duplicate.duplicate,true);
});

test('event automation evaluates condition before dispatch',async()=>{
  const {service}=fixture();
  const automation=await service.create({userId:'u1',name:'high value',trigger:{kind:'EVENT',event:'provider.changed',source:'provider'},condition:{op:'GTE',path:'value',value:10},action:{tool:'text.echo',input:{text:'hit'},risk:'READ_ONLY'}});
  const low=await service.trigger(automation.id,{deliveryId:'e1',trigger:{kind:'EVENT',event:'provider.changed',source:'provider'},payload:{value:5}});
  assert.equal(low.status,'NO_ACTION');
  const high=await service.trigger(automation.id,{deliveryId:'e2',trigger:{kind:'EVENT',event:'provider.changed',source:'provider'},payload:{value:12}});
  assert.equal(high.status,'DISPATCHED');
});

test('trigger mismatch fails closed',async()=>{
  const {service}=fixture();
  const automation=await service.create({userId:'u1',name:'event',trigger:{kind:'EVENT',event:'a'},action:{tool:'text.echo',input:{text:'x'},risk:'READ_ONLY'}});
  await assert.rejects(service.trigger(automation.id,{deliveryId:'e1',trigger:{kind:'EVENT',event:'b'}}),(error)=>error.code==='TRIGGER_MISMATCH');
});

test('external-write automation still enters normal WAITING_APPROVAL policy gate',async()=>{
  const {service}=fixture();
  const automation=await service.create({userId:'u1',name:'write note',trigger:{kind:'EVENT',event:'go'},action:{tool:'note.write',input:{name:'auto',content:'hello'},risk:'LOCAL_WRITE'}});
  const result=await service.trigger(automation.id,{deliveryId:'w1',trigger:{kind:'EVENT',event:'go'},payload:{}});
  assert.equal(result.status,'DISPATCHED');
  assert.equal(result.result.objective.status,'WAITING_APPROVAL');
  assert.equal(result.result.authorization.tool,'note.write');
});

test('disable, inspect and delete lifecycle is explicit',async()=>{
  const {service}=fixture();
  const automation=await service.create({userId:'u1',name:'toggle',trigger:{kind:'EVENT',event:'go'},action:{tool:'text.echo',input:{text:'x'},risk:'READ_ONLY'}});
  await service.setEnabled(automation.id,false);
  assert.equal((await service.get(automation.id)).enabled,false);
  assert.equal((await service.trigger(automation.id,{deliveryId:'x1',trigger:{kind:'EVENT',event:'go'}})).status,'DISABLED');
  const deleted=await service.delete(automation.id);
  assert.equal(deleted.deleted,true);
  await assert.rejects(service.get(automation.id),/automation not found/);
});

test('delivery idempotency survives automation service restart when store is reused',async()=>{
  const store=createMemoryAutomationStore();
  const first=fixture({store});
  const automation=await first.service.create({userId:'u1',name:'restart',trigger:{kind:'EVENT',event:'go'},action:{tool:'text.echo',input:{text:'x'},risk:'READ_ONLY'}});
  await first.service.trigger(automation.id,{deliveryId:'same',trigger:{kind:'EVENT',event:'go'}});
  const second=fixture({store});
  const duplicate=await second.service.trigger(automation.id,{deliveryId:'same',trigger:{kind:'EVENT',event:'go'}});
  assert.equal(duplicate.status,'DUPLICATE');
});

test('quota policy blocks dispatch before runtime action when allowance is exhausted',async()=>{
  const catalog=createPlanCatalog({FREE:{id:'FREE',capabilities:['text.echo'],limits:{'executions.daily':1}}});
  const entitlements=createEntitlementService({catalog});
  const meter=createUsageMeter({entitlements});
  const quotaPolicy=createQuotaPolicy({entitlements,meter});
  const {service}=fixture({quotaPolicy,meter});
  const automation=await service.create({userId:'u1',name:'quota',trigger:{kind:'EVENT',event:'go'},action:{tool:'text.echo',capability:'text.echo',input:{text:'x'},risk:'READ_ONLY'}});
  const first=await service.trigger(automation.id,{deliveryId:'q1',trigger:{kind:'EVENT',event:'go'}});
  assert.equal(first.status,'DISPATCHED');
  const blocked=await service.trigger(automation.id,{deliveryId:'q2',trigger:{kind:'EVENT',event:'go'}});
  assert.equal(blocked.status,'LIMIT_REACHED');
});

test('file-backed automation and delivery idempotency survive service restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-automations-'));
  try{
    const first=fixture({store:createFileAutomationStore({rootDir:dir})});
    const automation=await first.service.create({userId:'u1',name:'scheduled',trigger:{kind:'SCHEDULE',schedule:'0 9 * * *',timezone:'America/Sao_Paulo'},action:{tool:'text.echo',input:{text:'daily'},risk:'READ_ONLY'}});
    const firstDelivery=await first.service.trigger(automation.id,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{at:'09:00'}});
    assert.equal(firstDelivery.status,'DISPATCHED');
    const second=fixture({store:createFileAutomationStore({rootDir:dir})});
    assert.equal((await second.service.get(automation.id)).name,'scheduled');
    const duplicate=await second.service.trigger(automation.id,{deliveryId:'tick-1',trigger:{kind:'SCHEDULE'},payload:{at:'09:00'}});
    assert.equal(duplicate.status,'DUPLICATE');
    assert.equal(duplicate.duplicate,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('disable state and delete persist across file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-automations-state-'));
  try{
    const first=fixture({store:createFileAutomationStore({rootDir:dir})});
    const automation=await first.service.create({userId:'u1',name:'event',trigger:{kind:'EVENT',event:'provider.changed',source:'provider'},action:{tool:'text.echo',input:{text:'x'},risk:'READ_ONLY'}});
    await first.service.setEnabled(automation.id,false);
    const second=fixture({store:createFileAutomationStore({rootDir:dir})});
    assert.equal((await second.service.get(automation.id)).enabled,false);
    assert.equal((await second.service.trigger(automation.id,{deliveryId:'e1',trigger:{kind:'EVENT',event:'provider.changed',source:'provider'}})).status,'DISABLED');
    await second.service.delete(automation.id);
    const third=fixture({store:createFileAutomationStore({rootDir:dir})});
    await assert.rejects(third.service.get(automation.id),/automation not found/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
