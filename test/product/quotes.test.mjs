import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureQuoteProvider, createQuoteService } from '../../src/product/quotes.mjs';

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
