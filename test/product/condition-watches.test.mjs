import assert from 'node:assert/strict';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createAutomationService, createMemoryAutomationStore, createNaiaAutomationDispatcher } from '../../src/product/automations.mjs';
import { createConditionWatchService, createMemoryConditionWatchStore, evaluateWatchPredicate } from '../../src/product/condition-watches.mjs';

function fixture({watchStore=createMemoryConditionWatchStore(),automationStore=createMemoryAutomationStore(),clock='2026-09-19T13:00:00Z'}={}){
  const naia=createNaiaService(createInMemoryPorts());
  const automationService=createAutomationService({store:automationStore,dispatcher:createNaiaAutomationDispatcher(naia),now:()=>clock});
  let id=0;
  const watchService=createConditionWatchService({store:watchStore,automationService,idFactory:()=> 'watch-'+(++id),now:()=>clock});
  return {naia,automationService,watchService,watchStore,automationStore};
}

test('price threshold notifies only on false-to-true crossings',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'price <= 100',predicate:{kind:'PRICE_LTE',target:100},action:{tool:'text.echo',input:{text:'price hit'},risk:'READ_ONLY'}});
  assert.equal((await watchService.observe(watch.id,{id:'o1',source:'store',value:120})).notified,false);
  assert.equal((await watchService.observe(watch.id,{id:'o2',source:'store',value:99})).notified,true);
  assert.equal((await watchService.observe(watch.id,{id:'o3',source:'store',value:95})).notified,false);
  assert.equal((await watchService.observe(watch.id,{id:'o4',source:'store',value:110})).notified,false);
  assert.equal((await watchService.observe(watch.id,{id:'o5',source:'store',value:90})).notified,true);
});

test('unchanged observation is deduplicated and does not notify twice',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'stock',predicate:{kind:'IN_STOCK'},action:{tool:'text.echo',input:{text:'stock'},risk:'READ_ONLY'}});
  const first=await watchService.observe(watch.id,{id:'a',source:'store',inStock:true,state:'IN_STOCK'});
  const duplicate=await watchService.observe(watch.id,{id:'b',source:'store',inStock:true,state:'IN_STOCK'});
  assert.equal(first.notified,true);
  assert.equal(duplicate.status,'DUPLICATE_UNCHANGED');
  assert.equal(duplicate.notified,false);
});

test('unavailable to available stock transition emits one notification',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'stock',predicate:{kind:'IN_STOCK'},action:{tool:'text.echo',input:{text:'stock'},risk:'READ_ONLY'}});
  await watchService.observe(watch.id,{source:'store',inStock:false,state:'OUT_OF_STOCK'});
  const available=await watchService.observe(watch.id,{source:'store',inStock:true,state:'IN_STOCK'});
  assert.equal(available.matched,true);
  assert.equal(available.notified,true);
  const still=await watchService.observe(watch.id,{source:'store',inStock:true,state:'IN_STOCK',provenance:{page:'refresh'}});
  assert.equal(still.notified,false);
});

test('available slot watch triggers when at least one slot appears',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'slot',predicate:{kind:'AVAILABLE_SLOT_FOUND'},action:{tool:'text.echo',input:{text:'slot'},risk:'READ_ONLY'}});
  await watchService.observe(watch.id,{source:'booking',slots:[]});
  const hit=await watchService.observe(watch.id,{source:'booking',slots:['19:00']});
  assert.equal(hit.notified,true);
});

test('price drop percentage compares against previous fresh observation',()=>{
  assert.equal(evaluateWatchPredicate({kind:'PRICE_DROP_PCT',percentage:10},{value:89,slots:[]},{value:100}),true);
  assert.equal(evaluateWatchPredicate({kind:'PRICE_DROP_PCT',percentage:10},{value:95,slots:[]},{value:100}),false);
});

test('state-changed predicate emits on each actual semantic state transition',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'state',predicate:{kind:'STATE_CHANGED'},action:{tool:'text.echo',input:{text:'changed'},risk:'READ_ONLY'}});
  assert.equal((await watchService.observe(watch.id,{source:'svc',state:'A'})).notified,false);
  assert.equal((await watchService.observe(watch.id,{source:'svc',state:'B'})).notified,true);
  assert.equal((await watchService.observe(watch.id,{source:'svc',state:'C'})).notified,true);
});

test('stale observation remains explicit and never synthesizes positive condition',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'price',predicate:{kind:'PRICE_LTE',target:100},maxAgeMs:60_000,action:{tool:'text.echo',input:{text:'hit'},risk:'READ_ONLY'}});
  const stale=await watchService.observe(watch.id,{source:'store',value:50,observedAt:'2026-09-19T12:00:00Z'});
  assert.equal(stale.status,'STALE');
  assert.equal(stale.notified,false);
});

test('provider failure is explicit and does not mutate watch into matched state',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'price',predicate:{kind:'PRICE_LTE',target:100},action:{tool:'text.echo',input:{text:'hit'},risk:'READ_ONLY'}});
  const failure=await watchService.recordFailure(watch.id,{source:'store',code:'TIMEOUT',retryable:true});
  assert.equal(failure.status,'PROVIDER_FAILED');
  assert.equal(failure.notified,false);
  assert.equal((await watchService.get(watch.id)).lastMatched,false);
});

test('pause resume cancel lifecycle controls observation dispatch',async()=>{
  const {watchService}=fixture();
  const watch=await watchService.create({userId:'u1',name:'stock',predicate:{kind:'IN_STOCK'},action:{tool:'text.echo',input:{text:'stock'},risk:'READ_ONLY'}});
  await watchService.pause(watch.id);
  assert.equal((await watchService.observe(watch.id,{source:'s',inStock:true})).status,'PAUSED');
  await watchService.resume(watch.id);
  assert.equal((await watchService.observe(watch.id,{source:'s',inStock:true})).notified,true);
  await watchService.cancel(watch.id);
  assert.equal((await watchService.observe(watch.id,{source:'s',inStock:false})).status,'CANCELLED');
  await assert.rejects(watchService.resume(watch.id),/cancelled watch cannot resume/);
});

test('watch state and duplicate suppression survive service restart when stores are reused',async()=>{
  const watchStore=createMemoryConditionWatchStore();
  const automationStore=createMemoryAutomationStore();
  const first=fixture({watchStore,automationStore});
  const watch=await first.watchService.create({userId:'u1',name:'price',predicate:{kind:'PRICE_LTE',target:100},action:{tool:'text.echo',input:{text:'hit'},risk:'READ_ONLY'}});
  await first.watchService.observe(watch.id,{source:'store',value:90});
  const second=fixture({watchStore,automationStore});
  const duplicate=await second.watchService.observe(watch.id,{source:'store',value:90});
  assert.equal(duplicate.status,'DUPLICATE_UNCHANGED');
  assert.equal(duplicate.notified,false);
});
