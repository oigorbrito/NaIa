import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createEntitlementService, createPlanCatalog } from '../../src/product/entitlements.mjs';
import { createUsageMeter } from '../../src/product/metering.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFileImageGenerationStore, createFixtureImageProvider, createImageGenerationService, registerImageGenerationCapability } from '../../src/product/image-generation.mjs';

test('plan policy selects Free standard+watermark and paid higher quality without watermark',async()=>{
  const entitlements=createEntitlementService();
  const seen=[];const provider=createFixtureImageProvider({generate:async(input)=>{seen.push(input);return {providerGenerationId:`g${seen.length}`,assets:[],usage:{images:1}};}});
  const free=createImageGenerationService({provider,entitlements,idFactory:()=> 'free-1'});
  await free.generate({userId:'free',logicalId:'a',prompt:'cat'});
  await entitlements.setSubscription({userId:'pro',planId:'PRO'});
  const pro=createImageGenerationService({provider,entitlements,idFactory:()=> 'pro-1'});
  await pro.generate({userId:'pro',logicalId:'b',prompt:'dog'});
  await entitlements.setSubscription({userId:'ultra',planId:'ULTRA'});
  const ultra=createImageGenerationService({provider,entitlements,idFactory:()=> 'ultra-1'});
  await ultra.generate({userId:'ultra',logicalId:'c',prompt:'bird'});
  assert.deepEqual(seen.map(x=>[x.quality,x.watermark]),[['standard',true],['high',false],['premium',false]]);
});

test('quota blocks before provider invocation',async()=>{
  const catalog=createPlanCatalog({FREE:{id:'FREE',capabilities:['image.generate'],attributes:{imageQuality:'standard',imageWatermark:true},limits:{'imageGenerations.monthly':1}}});
  const entitlements=createEntitlementService({catalog});const meter=createUsageMeter({entitlements});let calls=0;
  const provider=createFixtureImageProvider({generate:async()=>{calls+=1;return {providerGenerationId:`g${calls}`,assets:[]};}});
  const service=createImageGenerationService({provider,entitlements,meter,idFactory:(()=>{let i=0;return()=>`g-${++i}`;})()});
  await service.generate({userId:'u1',logicalId:'one',prompt:'first'});
  await assert.rejects(service.generate({userId:'u1',logicalId:'two',prompt:'second'}),(e)=>e.code==='LIMIT_REACHED');
  assert.equal(calls,1);
});

test('same logical generation is never billed/generated twice',async()=>{
  const entitlements=createEntitlementService();const meter=createUsageMeter({entitlements});let calls=0;
  const provider=createFixtureImageProvider({generate:async(input)=>{calls+=1;return {providerGenerationId:'g1',assets:[{url:'https://x'}],usage:{images:1},model:'m1'};}});
  const service=createImageGenerationService({provider,entitlements,meter,idFactory:()=> 'local-1'});
  const first=await service.generate({userId:'u1',logicalId:'same',prompt:'x'});
  const duplicate=await service.generate({userId:'u1',logicalId:'same',prompt:'x'});
  assert.equal(first.duplicate,false);assert.equal(duplicate.duplicate,true);assert.equal(calls,1);
  assert.equal((await meter.inspect({userId:'u1',metric:'imageGenerations.monthly',window:'MONTH'})).used,1);
});

test('provider failure is recorded without secret and same logical retry does not invoke provider twice',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-image-'));
  try{
    const entitlements=createEntitlementService();let calls=0;
    const provider=createFixtureImageProvider({name:'provider-x',secret:'top-secret',generate:async()=>{calls+=1;const e=new Error('Authorization Bearer top-secret');e.code='RATE_LIMIT';e.retryable=true;throw e;}});
    const store=createFileImageGenerationStore({rootDir:dir});
    const service=createImageGenerationService({store,provider,entitlements,idFactory:()=> 'g1'});
    await assert.rejects(service.generate({userId:'u1',logicalId:'same',prompt:'x'}),(e)=>e.code==='RATE_LIMIT');
    const duplicate=await service.generate({userId:'u1',logicalId:'same',prompt:'x'});
    assert.equal(duplicate.duplicate,true);assert.equal(duplicate.generation.status,'FAILED');assert.equal(calls,1);
    const text=await readFile(store.path,'utf8');assert.equal(text.includes('top-secret'),false);assert.equal(text.includes('Authorization Bearer'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('file-backed generation metadata survives restart without provider credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-image-restart-'));
  try{
    const entitlements=createEntitlementService();const provider=createFixtureImageProvider({secret:'never-store'});
    const first=createImageGenerationService({store:createFileImageGenerationStore({rootDir:dir}),provider,entitlements,idFactory:()=> 'g1'});
    await first.generate({userId:'u1',logicalId:'x',prompt:'hello',metadata:{surface:'chat'}});
    const second=createImageGenerationService({store:createFileImageGenerationStore({rootDir:dir}),provider,entitlements});
    const rows=await second.list('u1');assert.equal(rows.length,1);assert.equal(rows[0].status,'COMPLETED');assert.equal(rows[0].metadata.surface,'chat');
    assert.equal((await readFile(join(dir,'image-generations.json'),'utf8')).includes('never-store'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('image.generate runs through normal NaIA approval policy',async()=>{
  const entitlements=createEntitlementService();let calls=0;
  const service=createImageGenerationService({provider:createFixtureImageProvider({generate:async()=>{calls+=1;return {assets:[]};}}),entitlements,idFactory:()=> 'g1'});
  const naia=createNaiaService(createInMemoryPorts());registerImageGenerationCapability(naia,{service,userId:'u1'});
  const pending=await naia.pursueAction({title:'Generate image',action:{tool:'image.generate',input:{logicalId:'img-1',prompt:'cat'},risk:'SENSITIVE',requiresApproval:true}});
  assert.equal(pending.objective.status,'WAITING_APPROVAL');assert.equal(calls,0);
  const completed=await naia.approve(pending.objective.id,'image.generate');assert.equal(completed.objective.status,'COMPLETED');assert.equal(calls,1);
});
