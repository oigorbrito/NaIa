import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontendApi } from '../../src/product/frontend-api.mjs';

function fakeNaia(){return {async pursue(){},async get(){return {objective:null}},async history(){return []},async approve(){},async resume(){}};}

test('frontend exposes optional advanced history search/export/delete service',async()=>{
  const historyIndex={
    async search({userId,query,limit}){return {planId:'PRO',retentionDays:365,items:[{id:'h1',userId,title:query,limit}]};},
    async export(userId){return {planId:'PRO',items:[{id:'h1',userId}]};},
    async delete({userId,id}){return {deleted:true,userId,id};},
  };
  const api=createFrontendApi({naia:fakeNaia(),userId:'u1',historyIndex});
  const search=await api.historySearch({query:'budget',limit:5});
  assert.equal(search.available,true);assert.equal(search.items[0].title,'budget');
  const exported=await api.historyExport();assert.equal(exported.ok,true);assert.equal(exported.export.items[0].userId,'u1');
  const deleted=await api.deleteHistory('h1');assert.equal(deleted.deleted,true);
});

test('frontend advanced history surface degrades explicitly when service is absent',async()=>{
  const api=createFrontendApi({naia:fakeNaia(),userId:'u1'});
  const search=await api.historySearch({query:'x'});
  assert.deepEqual(search,{ok:true,available:false,items:[]});
  assert.equal((await api.historyExport()).error.code,'CAPABILITY_UNAVAILABLE');
  assert.equal((await api.deleteHistory('x')).error.code,'CAPABILITY_UNAVAILABLE');
});
