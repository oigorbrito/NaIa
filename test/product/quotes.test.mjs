import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileQuoteStore, createFixtureQuoteProvider, createQuoteService, proposeQuoteContact, registerQuoteCapabilities } from '../../src/product/quotes.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

test('one quote request fans out to multiple providers and correlates responses', async () => {
  let id=0;
  const a=createFixtureQuoteProvider({name:'a',response:{id:'qa',price:100,availability:true,validUntil:'2026-09-21T00:00:00Z'}});
  const b=createFixtureQuoteProvider({name:'b',response:{id:'qb',price:90,availability:true,validUntil:'2026-09-21T00:00:00Z'}});
  const service=createQuoteService({providers:[a,b],idFactory:()=> 'req-'+(++id),now:()=> '2026-09-19T13:00:00Z'});
  const request=await service.create({userId:'u1',requirements:{service:'repair'}});
  const collected=await service.collect(request.id);
  assert.equal(collected.responses.length,2);
  assert.ok(collected.responses.every((row)=>row.requestId===request.id));
  assert.equal(collected.request.providerStates.a.state,'RESPONDED');
  assert.equal(collected.request.providerStates.b.state,'RESPONDED');
});

test('partial provider failure preserves successful quotes', async () => {
  const good=createFixtureQuoteProvider({name:'good',response:{id:'q1',price:120,availability:true}});
  const bad=createFixtureQuoteProvider({name:'bad',fail:{code:'TIMEOUT',message:'timeout',retryable:true}});
  const service=createQuoteService({providers:[good,bad],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'cleaning'}});
  const collected=await service.collect(request.id);
  assert.equal(collected.responses.length,1);
  assert.equal(collected.responses[0].provider,'good');
  assert.equal(collected.request.providerStates.bad.state,'FAILED');
  assert.equal(collected.request.providerStates.bad.retryable,true);
});

test('comparison preserves source, validity and ranks selectable live quotes', async () => {
  const a=createFixtureQuoteProvider({name:'a',response:{id:'q1',price:110,availability:true,validUntil:'2026-09-21T00:00:00Z',source:{channel:'email'}}});
  const b=createFixtureQuoteProvider({name:'b',response:{id:'q2',price:90,availability:false,validUntil:'2026-09-21T00:00:00Z',source:{channel:'web'}}});
  const service=createQuoteService({providers:[a,b],idFactory:()=> 'req-1',now:()=> '2026-09-19T13:00:00Z'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  await service.collect(request.id);
  const comparison=await service.compare(request.id,{at:'2026-09-19T14:00:00Z'});
  assert.equal(comparison.responses[0].provider,'a');
  assert.equal(comparison.selectable.length,1);
  assert.deepEqual(comparison.selectable[0].source,{channel:'email'});
});

test('expired quote is explicit and excluded from selectable options', async () => {
  const provider=createFixtureQuoteProvider({name:'a',response:{id:'q1',price:50,availability:true,validUntil:'2026-09-18T00:00:00Z'}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1',now:()=> '2026-09-19T13:00:00Z'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  await service.collect(request.id);
  const comparison=await service.compare(request.id,{at:'2026-09-19T13:00:00Z'});
  assert.equal(comparison.responses[0].expired,true);
  assert.equal(comparison.selectable.length,0);
});

test('pending providers become expired when request validity closes', async () => {
  const pending=createFixtureQuoteProvider({name:'slow',response:null});
  const service=createQuoteService({providers:[pending],idFactory:()=> 'req-1',now:()=> '2026-09-19T13:00:00Z'});
  const request=await service.create({userId:'u1',requirements:{service:'x'},expiresAt:'2026-09-20T00:00:00Z'});
  await service.collect(request.id);
  const expired=await service.expire(request.id,{at:'2026-09-21T00:00:00Z'});
  assert.equal(expired.providerStates.slow.state,'EXPIRED');
});

test('outbound retries use one stable provider idempotency key', async () => {
  const provider=createFixtureQuoteProvider({name:'a',response:{id:'q1',price:80,availability:true}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  await service.collect(request.id);
  await service.collect(request.id);
  assert.equal(provider.callCount(),1);
});

test('duplicate response collection does not create duplicate normalized responses', async () => {
  const provider=createFixtureQuoteProvider({name:'a',response:{id:'same-response',price:80,availability:true}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  const first=await service.collect(request.id);
  const second=await service.collect(request.id);
  assert.equal(first.responses.length,1);
  assert.equal(second.responses.length,1);
});

test('quote collection has no implicit booking or purchase commitment', async () => {
  const provider=createFixtureQuoteProvider({name:'a',response:{id:'q1',price:80,availability:true}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  const collected=await service.collect(request.id);
  assert.equal('booking' in collected,false);
  assert.equal('order' in collected,false);
  assert.equal('commitment' in collected,false);
});

test('quote request/responses/outbound idempotency survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-quotes-'));
  try{
    const provider=createFixtureQuoteProvider({name:'a',response:{id:'q1',price:80,availability:true}});
    const first=createQuoteService({providers:[provider],store:createFileQuoteStore({rootDir:dir}),idFactory:()=> 'req-1'});
    const request=await first.create({userId:'u1',requirements:{service:'x'}});
    await first.collect(request.id);
    const second=createQuoteService({providers:[provider],store:createFileQuoteStore({rootDir:dir})});
    const collected=await second.collect(request.id);
    assert.equal(collected.responses.length,1);
    assert.equal(provider.callCount(),1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('external-write quote provider is not contacted by passive collect',async()=>{
  const provider=createFixtureQuoteProvider({name:'email-shop',contactRisk:'EXTERNAL_WRITE',response:{id:'q1',price:100,availability:true}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'repair'}});
  const collected=await service.collect(request.id);
  assert.equal(collected.request.providerStates['email-shop'].state,'AWAITING_APPROVAL');
  assert.equal(provider.callCount(),0);
});

test('external-write quote contact uses normal runtime WAITING_APPROVAL and executes once',async()=>{
  const provider=createFixtureQuoteProvider({name:'email-shop',contactRisk:'EXTERNAL_WRITE',response:{id:'q1',price:100,availability:true}});
  const service=createQuoteService({providers:[provider],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'repair'}});
  await service.collect(request.id);
  const naia=createNaiaService(createInMemoryPorts());registerQuoteCapabilities(naia,{service});
  const pending=await proposeQuoteContact(naia,{requestId:request.id,providerName:'email-shop'});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');assert.equal(provider.callCount(),0);
  const completed=await naia.approve(pending.objective.id,'quote.contact');
  assert.equal(completed.objective.status,'COMPLETED');assert.equal(provider.callCount(),1);
  const duplicate=await service.collectProviderApproved(request.id,'email-shop');
  assert.equal(duplicate.duplicate,true);assert.equal(provider.callCount(),1);
});

test('approved quote outreach failure remains isolated and does not erase other responses',async()=>{
  const good=createFixtureQuoteProvider({name:'api',response:{id:'good',price:90,availability:true}});
  const bad=createFixtureQuoteProvider({name:'email',contactRisk:'EXTERNAL_WRITE',fail:{code:'TIMEOUT',retryable:true}});
  const service=createQuoteService({providers:[good,bad],idFactory:()=> 'req-1'});
  const request=await service.create({userId:'u1',requirements:{service:'x'}});
  await service.collect(request.id);
  await assert.rejects(service.collectProviderApproved(request.id,'email'),(e)=>e.code==='TIMEOUT');
  const comparison=await service.compare(request.id);
  assert.equal(comparison.responses.length,1);assert.equal(comparison.responses[0].provider,'api');
  assert.equal(comparison.request.providerStates.email.state,'FAILED');
});
