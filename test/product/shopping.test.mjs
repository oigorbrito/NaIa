import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  buildShoppingProposal,
  createFileShoppingStore,
  createFixtureShoppingProvider,
  createShoppingService,
  normalizeShoppingItems,
  proposeShoppingCommit,
  registerShoppingCapabilities,
} from '../../src/product/shopping.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

test('normalizes shopping items with quantities and substitution policy', () => {
  assert.deepEqual(normalizeShoppingItems([
    { name: 'milk', quantity: 2, substitutionsAllowed: false },
  ]), [
    { key: 'item-1', name: 'milk', quantity: 2, unit: 'unit', substitutionsAllowed: false, constraints: {} },
  ]);
});

test('single-store proposal prefers complete basket before cheaper incomplete basket', () => {
  const proposal = buildShoppingProposal([
    { provider: 'cheap', revision: '1', fee: 0, items: [
      { key: 'a', available: true, quantity: 1, unitPrice: 1 },
      { key: 'b', available: false, quantity: 1, unitPrice: 0 },
    ] },
    { provider: 'complete', revision: '1', fee: 5, items: [
      { key: 'a', available: true, quantity: 1, unitPrice: 3 },
      { key: 'b', available: true, quantity: 1, unitPrice: 3 },
    ] },
  ], { strategy: 'SINGLE_STORE' });
  assert.equal(proposal.selected.provider, 'complete');
  assert.equal(proposal.selected.total, 11);
});

test('split-basket comparison chooses cheapest item-level options but remains non-executable in v1', () => {
  const proposal = buildShoppingProposal([
    { provider: 'a', revision: '1', fee: 2, items: [
      { key: 'milk', available: true, quantity: 1, unitPrice: 5 },
      { key: 'bread', available: true, quantity: 1, unitPrice: 9 },
    ] },
    { provider: 'b', revision: '1', fee: 3, items: [
      { key: 'milk', available: true, quantity: 1, unitPrice: 6 },
      { key: 'bread', available: true, quantity: 1, unitPrice: 4 },
    ] },
  ], { strategy: 'SPLIT_BASKET' });
  assert.equal(proposal.selected.items.find((row)=>row.key==='milk').provider, 'a');
  assert.equal(proposal.selected.items.find((row)=>row.key==='bread').provider, 'b');
  assert.equal(proposal.executable, false);
  assert.equal(proposal.executionReason, 'MULTI_ORDER_REQUIRES_SEPARATE_APPROVALS');
});

test('provider surfaces substitution and blocks it when user disallows substitution', async () => {
  const provider=createFixtureShoppingProvider({ name:'store', catalog:{ milk:{unitPrice:5,substitute:'oat milk'} } });
  const service=createShoppingService({providers:[provider]});
  const allowed=await service.quote({items:[{name:'milk',substitutionsAllowed:true}]});
  assert.deepEqual(allowed.proposal.selected.items[0].substitution,{from:'milk',to:'oat milk'});
  const blocked=await service.quote({items:[{name:'milk',substitutionsAllowed:false}]});
  assert.equal(blocked.proposal.selected.items[0].available,false);
  assert.equal(blocked.proposal.selected.items[0].unavailableReason,'SUBSTITUTION_NOT_ALLOWED');
});

test('order cannot execute without approval bound to concrete cart and total', async () => {
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  let id=0;
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-'+(++id)});
  const quote=await service.quote({items:[{name:'rice',quantity:2}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  assert.equal(action.payload.total,20);
  await assert.rejects(service.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-1'}),(error)=>error.code==='APPROVAL_REQUIRED');
});

test('approved order executes once and retries are idempotent', async () => {
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  let id=0;
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-'+(++id)});
  const quote=await service.quote({items:[{name:'rice',quantity:2}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  await service.approve(action.id,action.fingerprint);
  const first=await service.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-1'});
  const duplicate=await service.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-1'});
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(provider.orders().length,1);
});

test('quote revision change invalidates prior approval before purchase', async () => {
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  let id=0;
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-'+(++id)});
  const quote=await service.quote({items:[{name:'rice'}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  await service.approve(action.id,action.fingerprint);
  provider.setRevision('2');
  await assert.rejects(service.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-stale'}),(error)=>error.code==='QUOTE_CHANGED');
  assert.equal((await service.getAction(action.id)).status,'WAITING_REVIEW');
  assert.equal(provider.orders().length,0);
});

test('cancelled pending order cannot later execute without renewed action', async () => {
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  let id=0;
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-'+(++id)});
  const quote=await service.quote({items:[{name:'rice'}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  await service.approve(action.id,action.fingerprint);
  await service.cancel(action.id);
  await assert.rejects(service.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'cancelled-order'}),(error)=>error.code==='APPROVAL_REQUIRED');
});

test('shopping action and commit ledger survive restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-shopping-'));
  try{
    const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
    const first=createShoppingService({providers:[provider],store:createFileShoppingStore({rootDir:dir}),idFactory:()=> 'action-1'});
    const quote=await first.quote({items:[{name:'rice',quantity:2}]});
    const action=await first.prepareOrder({userId:'u1',quoteResult:quote});
    await first.approve(action.id,action.fingerprint);
    await first.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-1'});
    const second=createShoppingService({providers:[provider],store:createFileShoppingStore({rootDir:dir})});
    const duplicate=await second.execute(action.id,{fingerprint:action.fingerprint,idempotencyKey:'order-1'});
    assert.equal(duplicate.duplicate,true);
    assert.equal(provider.orders().length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('shopping purchase goes through normal WAITING_APPROVAL runtime state',async()=>{
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-1'});
  const quote=await service.quote({items:[{name:'rice'}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  const naia=createNaiaService(createInMemoryPorts());
  registerShoppingCapabilities(naia,{service});
  const pending=await proposeShoppingCommit(naia,action,{idempotencyKey:'runtime-order'});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  assert.equal(provider.orders().length,0);
  const completed=await naia.approve(pending.objective.id,'shopping.commit');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(provider.orders().length,1);
});

test('quote revision drift after runtime approval prevents order and requires review',async()=>{
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-1'});
  const quote=await service.quote({items:[{name:'rice'}]});
  const action=await service.prepareOrder({userId:'u1',quoteResult:quote});
  const naia=createNaiaService(createInMemoryPorts());registerShoppingCapabilities(naia,{service});
  const pending=await proposeShoppingCommit(naia,action,{idempotencyKey:'stale-runtime'});
  provider.setRevision('2');
  const failed=await naia.approve(pending.objective.id,'shopping.commit');
  assert.equal(failed.objective.status,'FAILED');
  assert.equal((await service.getAction(action.id)).status,'WAITING_REVIEW');
  assert.equal(provider.orders().length,0);
});

test('cancelled shopping action remains non-executable through runtime commit capability',async()=>{
  const provider=createFixtureShoppingProvider({name:'store',catalog:{rice:{unitPrice:10}}});
  const service=createShoppingService({providers:[provider],idFactory:()=> 'action-1'});
  const quote=await service.quote({items:[{name:'rice'}]});const action=await service.prepareOrder({userId:'u1',quoteResult:quote});await service.cancel(action.id);
  const naia=createNaiaService(createInMemoryPorts());registerShoppingCapabilities(naia,{service});
  const pending=await proposeShoppingCommit(naia,action,{idempotencyKey:'cancelled'});
  const failed=await naia.approve(pending.objective.id,'shopping.commit');
  assert.equal(failed.objective.status,'FAILED');assert.equal(provider.orders().length,0);
});
