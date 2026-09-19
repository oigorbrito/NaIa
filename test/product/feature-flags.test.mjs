import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createFeatureFlagService } from '../../src/product/feature-flags.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

test('feature flag can target premium plan without exposing globally',async()=>{
  const entitlements=createEntitlementService();
  await entitlements.setSubscription({userId:'pro-user',planId:'PRO'});
  await entitlements.setSubscription({userId:'free-user',planId:'FREE'});
  const flags=createFeatureFlagService({entitlements});
  await flags.upsert({id:'new-model',plans:['PRO','ULTRA'],percentage:100});
  assert.equal((await flags.evaluate({flagId:'new-model',userId:'pro-user'})).enabled,true);
  const free=await flags.evaluate({flagId:'new-model',userId:'free-user'});
  assert.equal(free.enabled,false);
  assert.equal(free.reason,'PLAN_NOT_TARGETED');
});

test('explicit include and exclude cohorts are deterministic',async()=>{
  const flags=createFeatureFlagService();
  await flags.upsert({id:'cohort',percentage:0,includeUsers:['u1'],excludeUsers:['u2']});
  assert.equal((await flags.evaluate({flagId:'cohort',userId:'u1'})).reason,'USER_INCLUDED');
  assert.equal((await flags.evaluate({flagId:'cohort',userId:'u2'})).reason,'USER_EXCLUDED');
  assert.equal((await flags.evaluate({flagId:'cohort',userId:'u3'})).enabled,false);
});

test('percentage rollout bucket and result are stable for the same user and flag',async()=>{
  const flags=createFeatureFlagService();
  await flags.upsert({id:'rollout',percentage:37});
  const a=await flags.evaluate({flagId:'rollout',userId:'u1'});
  const b=await flags.evaluate({flagId:'rollout',userId:'u1'});
  assert.equal(a.bucket,b.bucket);
  assert.equal(a.enabled,b.enabled);
  assert.ok(a.bucket>=0&&a.bucket<10000);
});

test('flagged read-only capability is blocked before execution when user is outside rollout',async()=>{
  let ran=0;
  const flags=createFeatureFlagService();
  await flags.upsert({id:'beta-read',percentage:0});
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports,{featureFlags:flags,userId:'u1'});
  naia.registerCapability({name:'beta.read',tool:{risk:'READ_ONLY',featureFlag:'beta-read',async run(){ran+=1;return {ok:true};}}});
  const result=await naia.pursueAction({title:'beta',action:{tool:'beta.read',input:{},risk:'READ_ONLY',requiresApproval:false}});
  assert.equal(result.objective.status,'FAILED');
  assert.equal(result.plan.steps[1].error,'FEATURE_NOT_ENABLED');
  assert.equal(ran,0);
  const evidence=await ports.evidence.list({objectiveId:result.objective.id});
  assert.ok(evidence.some((row)=>row.type==='FEATURE_FLAG_DECISION'&&row.flagId==='beta-read'&&row.enabled===false));
});

test('enabled feature visibility does not bypass normal write approval policy',async()=>{
  let writes=0;
  const flags=createFeatureFlagService();
  await flags.upsert({id:'beta-write',percentage:100});
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports,{featureFlags:flags,userId:'u1'});
  naia.registerCapability({name:'beta.write',tool:{risk:'LOCAL_WRITE',featureFlag:'beta-write',async run(){writes+=1;return {ok:true};}}});
  const pending=await naia.pursueAction({title:'beta write',action:{tool:'beta.write',input:{},risk:'LOCAL_WRITE',requiresApproval:true}});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  assert.equal(writes,0);
  const completed=await naia.approve(pending.objective.id,'beta.write');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(writes,1);
});

test('kill switch disables future use immediately even for already-created pending objective',async()=>{
  let writes=0;
  const flags=createFeatureFlagService();
  await flags.upsert({id:'beta-write',percentage:100});
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports,{featureFlags:flags,userId:'u1'});
  naia.registerCapability({name:'beta.write',tool:{risk:'LOCAL_WRITE',featureFlag:'beta-write',async run(){writes+=1;return {ok:true};}}});
  const pending=await naia.pursueAction({title:'beta write',action:{tool:'beta.write',input:{},risk:'LOCAL_WRITE',requiresApproval:true}});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  await flags.setKillSwitch('beta-write',true);
  const blocked=await naia.approve(pending.objective.id,'beta.write');
  assert.equal(blocked.objective.status,'FAILED');
  assert.equal(blocked.featureFlag.reason,'KILL_SWITCH');
  assert.equal(writes,0);
  const evidence=await ports.evidence.list({objectiveId:pending.objective.id});
  assert.ok(evidence.some((row)=>row.type==='FEATURE_FLAG_DECISION'&&row.reason==='KILL_SWITCH'));
});

test('flagged capability fails closed when rollout service is not configured',async()=>{
  let ran=0;
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports,{userId:'u1'});
  naia.registerCapability({name:'beta.read',tool:{risk:'READ_ONLY',featureFlag:'missing-service',async run(){ran+=1;return {};}}});
  const result=await naia.pursueAction({title:'beta',action:{tool:'beta.read',input:{},risk:'READ_ONLY',requiresApproval:false}});
  assert.equal(result.objective.status,'FAILED');
  assert.equal(result.featureFlag.reason,'FLAG_SERVICE_UNAVAILABLE');
  assert.equal(ran,0);
});

test('tool catalog exposes feature flag metadata for UI visibility decisions',()=>{
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports);
  naia.registerCapability({name:'beta.read',tool:{risk:'READ_ONLY',featureFlag:'beta-read',description:'Beta',async run(){return {};}}});
  const tool=naia.tools().find((row)=>row.name==='beta.read');
  assert.equal(tool.featureFlag,'beta-read');
});
