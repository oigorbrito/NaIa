import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createHistoryService } from '../../src/product/history.mjs';
import { createSupportService, scanSupportBundleForSecrets } from '../../src/product/support.mjs';

function snapshot({id='o1',updatedAt='2026-09-19T12:00:00Z',error=null}={}){
  return {
    objective:{id,title:'Support test',description:'safe description',status:error?'FAILED':'COMPLETED',createdAt:updatedAt,updatedAt,approvals:['email.send'],confirmations:[]},
    plan:{intent:'SUPPORT_TEST',steps:[{id:id+':1',kind:'EXECUTE',status:error?'FAILED':'COMPLETED',action:{tool:'email.send',risk:'EXTERNAL_WRITE'}}]},
    evidence:[{type:error?'STEP_FAILED':'STEP_EXECUTED',objectiveId:id,tool:'email.send',provider:'gmail',ok:!error,output:error?{error}: {result:'ok'},at:updatedAt}],
  };
}

async function fixture(planId='PRO'){
  const entitlements=createEntitlementService();
  await entitlements.setSubscription({userId:'u1',planId});
  const history=createHistoryService({entitlements,now:()=>new Date('2026-09-19T15:00:00Z'),idFactory:(()=>{let i=0;return()=>`h${++i}`;})()});
  return {entitlements,history};
}

test('support priority is a concrete plan attribute',async()=>{
  const entitlements=createEntitlementService();
  await entitlements.setSubscription({userId:'free',planId:'FREE'});
  await entitlements.setSubscription({userId:'pro',planId:'PRO'});
  await entitlements.setSubscription({userId:'ultra',planId:'ULTRA'});
  assert.equal((await entitlements.attribute('free','supportPriority')).value,'STANDARD');
  assert.equal((await entitlements.attribute('pro','supportPriority')).value,'PRIORITY');
  assert.equal((await entitlements.attribute('ultra','supportPriority')).value,'PRIORITY');
});

test('free plan cannot generate priority support bundle',async()=>{
  const {entitlements,history}=await fixture('FREE');
  const support=createSupportService({entitlements,historyIndex:history});
  await assert.rejects(support.prepareBundle({userId:'u1'}),(error)=>error.code==='NOT_ENTITLED');
  assert.deepEqual(await support.routing('u1'),{queue:'STANDARD',priority:'STANDARD',planId:'FREE'});
});

test('paid user can inspect sanitized support context before sharing',async()=>{
  const {entitlements,history}=await fixture('PRO');
  await history.ingestObjective({userId:'u1',provider:'gmail',snapshot:snapshot({id:'o1'})});
  const support=createSupportService({entitlements,historyIndex:history,version:'1.2.3',runtimeInfo:{platform:'android',build:'42'},idFactory:()=> 'bundle-1',now:()=> '2026-09-19T15:00:00Z'});
  const bundle=await support.prepareBundle({userId:'u1'});
  const preview=support.inspect(bundle);
  assert.equal(preview.id,'bundle-1');
  assert.equal(preview.payload.version,'1.2.3');
  assert.equal(preview.payload.planId,'PRO');
  assert.equal(preview.payload.objectiveCount,1);
  assert.equal(preview.payload.objectives[0].objectiveId,'o1');
  assert.deepEqual(preview.payload.objectives[0].capabilities,['email.send']);
  assert.deepEqual(await support.routing('u1'),{queue:'PRIORITY',priority:'PRIORITY',planId:'PRO'});
});

test('support bundle includes useful error metadata but excludes sensitive persisted content',async()=>{
  const {entitlements,history}=await fixture('PRO');
  const dangerous='request failed authorization=Bearer abc.def.ghi token=super-secret hmac=sha256=abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  await history.ingestObjective({userId:'u1',provider:'gmail',snapshot:snapshot({id:'o1',error:dangerous})});
  const support=createSupportService({entitlements,historyIndex:history,version:'1.0.0',runtimeInfo:{authorization:'Bearer hidden-runtime',safe:'yes'},idFactory:()=> 'bundle-1',now:()=> '2026-09-19T15:00:00Z'});
  const bundle=await support.prepareBundle({userId:'u1'});
  const encoded=JSON.stringify(bundle);
  assert.equal(encoded.includes('super-secret'),false);
  assert.equal(encoded.includes('hidden-runtime'),false);
  assert.equal(encoded.includes('abc.def.ghi'),false);
  assert.equal(encoded.includes('abcdefabcdefabcdef'),false);
  assert.equal(encoded.includes('request failed'),true);
  assert.equal(scanSupportBundleForSecrets(bundle).clean,true);
});

test('support bundle excludes conversation bodies and raw evidence payloads by construction',async()=>{
  const {entitlements,history}=await fixture('PRO');
  const snap=snapshot({id:'o1'});
  snap.conversation=[{role:'user',text:'very private conversation body'}];
  snap.evidence.push({type:'DEBUG',objectiveId:'o1',payload:{body:'very private payload'},at:'2026-09-19T12:00:00Z'});
  await history.ingestObjective({userId:'u1',snapshot:snap});
  const support=createSupportService({entitlements,historyIndex:history,idFactory:()=> 'b1'});
  const bundle=await support.prepareBundle({userId:'u1'});
  const encoded=JSON.stringify(bundle);
  assert.equal(encoded.includes('very private conversation body'),false);
  assert.equal(encoded.includes('very private payload'),false);
});

test('objective selection limits support context to user-approved IDs',async()=>{
  const {entitlements,history}=await fixture('PRO');
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'o1',updatedAt:'2026-09-19T12:00:00Z'})});
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'o2',updatedAt:'2026-09-19T13:00:00Z'})});
  const support=createSupportService({entitlements,historyIndex:history,idFactory:()=> 'b1'});
  const bundle=await support.prepareBundle({userId:'u1',objectiveIds:['o1']});
  assert.deepEqual(bundle.payload.objectives.map(r=>r.objectiveId),['o1']);
});

test('same diagnostic payload produces stable fingerprint for audit/confirmation',async()=>{
  const {entitlements,history}=await fixture('PRO');
  await history.ingestObjective({userId:'u1',snapshot:snapshot({id:'o1'})});
  const support=createSupportService({entitlements,historyIndex:history,version:'1',runtimeInfo:{platform:'web'},idFactory:(()=>{let i=0;return()=>`b${++i}`;})(),now:()=> '2026-09-19T15:00:00Z'});
  const a=await support.prepareBundle({userId:'u1'});
  const b=await support.prepareBundle({userId:'u1'});
  assert.notEqual(a.id,b.id);
  assert.equal(a.fingerprint,b.fingerprint);
});
