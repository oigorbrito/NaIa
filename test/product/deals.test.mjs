import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createDealService, createFileDealStore, dealToRadarSignal, dealToWatchObservation } from '../../src/product/deals.mjs';

function service(){ let i=0; return createDealService({idFactory:()=> 'obs-'+(++i),now:()=> '2026-09-19T13:00:00Z'}); }

test('fixed fresh history can yield deterministic NEW_LOW and MATERIALLY_BELOW_REFERENCE',async()=>{
  const deals=service();
  await deals.record({targetId:'phone',offerId:'a',source:'s',observedAt:'2026-09-17T10:00:00Z',price:1200,fees:0});
  await deals.record({targetId:'phone',offerId:'a',source:'s',observedAt:'2026-09-18T10:00:00Z',price:1100,fees:0});
  await deals.record({targetId:'phone',offerId:'a',source:'s',observedAt:'2026-09-19T12:00:00Z',price:900,fees:0});
  const result=await deals.evaluate('phone',{offerId:'a',minHistory:2,materialBelowPct:10,asOf:'2026-09-19T13:00:00Z'});
  assert.ok(result.signals.includes('NEW_LOW'));
  assert.ok(result.signals.includes('MATERIALLY_BELOW_REFERENCE'));
  assert.equal(result.reference.historyCount,2);
  assert.equal(result.reference.minTotal,1100);
});

test('configured threshold can be observed even when historical evidence is insufficient',async()=>{
  const deals=service();
  await deals.record({targetId:'flight',offerId:'x',source:'s',observedAt:'2026-09-19T12:00:00Z',price:450});
  const result=await deals.evaluate('flight',{offerId:'x',threshold:500,minHistory:3,asOf:'2026-09-19T13:00:00Z'});
  assert.ok(result.signals.includes('THRESHOLD_HIT'));
  assert.equal(result.confidence,'OBSERVED_THRESHOLD');
  assert.equal(result.reference.historyCount,0);
});

test('insufficient comparable history never fabricates historical discount claim',async()=>{
  const deals=service();
  await deals.record({targetId:'tv',offerId:'x',source:'s',observedAt:'2026-09-19T12:00:00Z',price:1000});
  const result=await deals.evaluate('tv',{offerId:'x',minHistory:2,asOf:'2026-09-19T13:00:00Z'});
  assert.deepEqual(result.signals,['INSUFFICIENT_EVIDENCE']);
  assert.equal(result.status,'INSUFFICIENT_EVIDENCE');
});

test('stale current observation is explicit and not treated as a deal',async()=>{
  const deals=service();
  await deals.record({targetId:'hotel',offerId:'x',source:'s',observedAt:'2026-09-18T00:00:00Z',price:300});
  const result=await deals.evaluate('hotel',{offerId:'x',maxCurrentAgeMs:60*60*1000,asOf:'2026-09-19T13:00:00Z'});
  assert.deepEqual(result.signals,['STALE']);
  assert.equal(result.status,'STALE');
});

test('currency and comparison key mismatches are excluded from historical reference',async()=>{
  const deals=service();
  await deals.record({targetId:'camera',offerId:'usd',source:'s',observedAt:'2026-09-18T10:00:00Z',price:500,currency:'USD',comparisonKey:'body-only'});
  await deals.record({targetId:'camera',offerId:'kit',source:'s',observedAt:'2026-09-18T11:00:00Z',price:700,currency:'BRL',comparisonKey:'kit'});
  await deals.record({targetId:'camera',offerId:'current',source:'s',observedAt:'2026-09-19T12:00:00Z',price:600,currency:'BRL',comparisonKey:'body-only'});
  const result=await deals.evaluate('camera',{offerId:'current',minHistory:1,asOf:'2026-09-19T13:00:00Z'});
  assert.equal(result.reference.historyCount,0);
  assert.deepEqual(result.signals,['INSUFFICIENT_EVIDENCE']);
});

test('fees affect ranking independently from sticker price',async()=>{
  const deals=service();
  await deals.record({targetId:'item',offerId:'cheap-sticker',source:'a',observedAt:'2026-09-19T12:00:00Z',price:90,fees:30,availability:true});
  await deals.record({targetId:'item',offerId:'higher-sticker',source:'b',observedAt:'2026-09-19T12:00:00Z',price:100,fees:5,availability:true});
  const ranked=await deals.rank('item',{asOf:'2026-09-19T13:00:00Z'});
  assert.equal(ranked[0].offerId,'higher-sticker');
  assert.equal(ranked[0].total,105);
});

test('availability and user constraints outrank a lower unusable offer',async()=>{
  const deals=service();
  await deals.record({targetId:'service',offerId:'bad',source:'a',observedAt:'2026-09-19T12:00:00Z',price:50,availability:false,attributes:{city:'A'}});
  await deals.record({targetId:'service',offerId:'good',source:'b',observedAt:'2026-09-19T12:00:00Z',price:80,availability:true,attributes:{city:'B'}});
  const ranked=await deals.rank('service',{constraints:{city:'B'},asOf:'2026-09-19T13:00:00Z'});
  assert.equal(ranked[0].offerId,'good');
  assert.ok(ranked[0].rankingReasons.includes('CONSTRAINTS_MATCH'));
});

test('duplicate unchanged observation does not distort history statistics',async()=>{
  const deals=service();
  const first=await deals.record({targetId:'book',offerId:'x',source:'store',observedAt:'2026-09-18T10:00:00Z',price:100});
  const duplicate=await deals.record({targetId:'book',offerId:'x',source:'store',observedAt:'2026-09-19T10:00:00Z',price:100});
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal((await deals.history('book')).length,1);
});

test('deal result bridge preserves positive and insufficient states for condition watches',async()=>{
  const deals=service();
  await deals.record({targetId:'x',offerId:'o',source:'s',observedAt:'2026-09-19T12:00:00Z',price:50});
  const hit=await deals.evaluate('x',{offerId:'o',threshold:60,asOf:'2026-09-19T13:00:00Z'});
  assert.equal(dealToWatchObservation(hit).state,'THRESHOLD_HIT');
  const insufficient=await deals.evaluate('x',{offerId:'o',threshold:null,minHistory:3,asOf:'2026-09-19T13:00:00Z'});
  const observation=dealToWatchObservation(insufficient);
  assert.equal(observation.state,'INSUFFICIENT_EVIDENCE');
  assert.equal(observation.available,false);
});

test('deal history and duplicate suppression survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-deals-'));
  try{
    let i=0;
    const first=createDealService({store:createFileDealStore({rootDir:dir}),idFactory:()=>`obs-${++i}`,now:()=> '2026-09-19T13:00:00Z'});
    await first.record({targetId:'phone',offerId:'a',source:'store',observedAt:'2026-09-18T10:00:00Z',price:1000});
    await first.record({targetId:'phone',offerId:'a',source:'store',observedAt:'2026-09-19T12:00:00Z',price:800});
    const second=createDealService({store:createFileDealStore({rootDir:dir}),idFactory:()=>`obs-${++i}`,now:()=> '2026-09-19T13:00:00Z'});
    const duplicate=await second.record({targetId:'phone',offerId:'a',source:'store',observedAt:'2026-09-20T12:00:00Z',price:800});
    assert.equal(duplicate.duplicate,true);
    assert.equal((await second.history('phone')).length,2);
    const result=await second.evaluate('phone',{offerId:'a',minHistory:1,asOf:'2026-09-19T13:00:00Z'});
    assert.ok(result.signals.includes('NEW_LOW'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('positive deal signals become Radar alerts with transparent reference basis',async()=>{
  const deals=service();
  await deals.record({targetId:'phone',offerId:'a',source:'store',observedAt:'2026-09-18T10:00:00Z',price:1000,provenance:{url:'offer-a'}});
  await deals.record({targetId:'phone',offerId:'a',source:'store',observedAt:'2026-09-19T12:00:00Z',price:800,provenance:{url:'offer-a'}});
  const result=await deals.evaluate('phone',{offerId:'a',minHistory:1,asOf:'2026-09-19T13:00:00Z'});
  const signal=dealToRadarSignal(result,{targetId:'phone',title:'Phone deal'});
  assert.equal(signal.type,'ALERT');
  assert.equal(signal.title,'Phone deal');
  assert.equal(signal.metadata.offerId,'a');
  assert.equal(signal.metadata.reference.historyCount,1);
  assert.equal(signal.metadata.confidence,'DERIVED_FROM_HISTORY');
  assert.deepEqual(signal.metadata.provenance,{url:'offer-a'});
});

test('stale, insufficient-evidence and no-deal results do not become Radar alerts',async()=>{
  const deals=service();
  await deals.record({targetId:'x',offerId:'o',source:'s',observedAt:'2026-09-18T00:00:00Z',price:100});
  const stale=await deals.evaluate('x',{offerId:'o',maxCurrentAgeMs:60*60*1000,asOf:'2026-09-19T13:00:00Z'});
  assert.equal(dealToRadarSignal(stale,{targetId:'x'}),null);
  const insufficient=await deals.evaluate('x',{offerId:'o',minHistory:2,maxCurrentAgeMs:7*24*60*60*1000,asOf:'2026-09-19T13:00:00Z'});
  assert.equal(dealToRadarSignal(insufficient,{targetId:'x'}),null);
  const normal=service();
  await normal.record({targetId:'y',offerId:'o',source:'s',observedAt:'2026-09-17T10:00:00Z',price:100});
  await normal.record({targetId:'y',offerId:'o',source:'s',observedAt:'2026-09-18T10:00:00Z',price:100});
  await normal.record({targetId:'y',offerId:'o',source:'s',observedAt:'2026-09-19T12:00:00Z',price:100});
  const noDeal=await normal.evaluate('y',{offerId:'o',minHistory:2,materialBelowPct:10,asOf:'2026-09-19T13:00:00Z'});
  assert.ok(noDeal.signals.includes('NO_DEAL'));
  assert.equal(dealToRadarSignal(noDeal,{targetId:'y'}),null);
});
