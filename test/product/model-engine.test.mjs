import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntitledModelEngine, createFixtureModelAdapter, createModelRegistry, createModelRouter, normalizeModelToolCalls } from '../../src/product/model-engine.mjs';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createUsageMeter } from '../../src/product/metering.mjs';

function fixture() {
  const registry = createModelRegistry();
  registry.registerProvider('openai', createFixtureModelAdapter({ name: 'openai', output: 'oa', secret: 'oa-secret' }));
  registry.registerProvider('anthropic', createFixtureModelAdapter({ name: 'anthropic', output: 'an', secret: 'an-secret' }));
  registry.registerProvider('gemini', createFixtureModelAdapter({ name: 'gemini', output: 'gm', secret: 'gm-secret' }));
  registry.registerModel({ provider: 'openai', id: 'gpt-x', class: 'advanced', capabilities: ['text','vision','tools','structured'], costRank: 3, latencyRank: 2 });
  registry.registerModel({ provider: 'anthropic', id: 'claude-x', class: 'advanced', capabilities: ['text','tools','structured'], costRank: 2, latencyRank: 3 });
  registry.registerModel({ provider: 'gemini', id: 'gemini-x', class: 'standard', capabilities: ['text','vision','structured'], costRank: 1, latencyRank: 1 });
  return { registry };
}

test('same provider-neutral request can execute through different adapters', async () => {
  const { registry } = fixture();
  const router = createModelRouter({ registry, now: () => '2026-09-19T12:00:00.000Z' });
  const openai = await router.request({ input: 'hello' }, { requiredCapabilities: ['text'], pinned: { provider: 'openai', model: 'gpt-x' } });
  const anthropic = await router.request({ input: 'hello' }, { requiredCapabilities: ['text'], pinned: { provider: 'anthropic', model: 'claude-x' } });
  assert.equal(openai.output, 'oa');
  assert.equal(anthropic.output, 'an');
  assert.equal(openai.routing.reason, 'pinned-model');
});

test('vision requirement never routes to model without vision', async () => {
  const { registry } = fixture();
  const router = createModelRouter({ registry });
  const result = await router.request({ input: 'image' }, { requiredCapabilities: ['vision'], preferredProvider: 'anthropic' });
  assert.notEqual(result.provider, 'anthropic');
  assert.ok(['openai','gemini'].includes(result.provider));
});

test('explicit cost policy chooses lowest-cost compatible healthy model', async () => {
  const { registry } = fixture();
  const router = createModelRouter({ registry });
  const result = await router.request({ input: 'classify' }, { requiredCapabilities: ['text','structured'], policy: 'cost' });
  assert.equal(result.provider, 'gemini');
});

test('provider failure falls back to next compatible model and records attempts', async () => {
  const registry = createModelRegistry();
  registry.registerProvider('a', createFixtureModelAdapter({ name: 'a', fail: true }));
  registry.registerProvider('b', createFixtureModelAdapter({ name: 'b', output: 'fallback-ok' }));
  registry.registerModel({ provider: 'a', id: 'a1', capabilities: ['text'], costRank: 1, latencyRank: 1 });
  registry.registerModel({ provider: 'b', id: 'b1', capabilities: ['text'], costRank: 2, latencyRank: 2 });
  const result = await createModelRouter({ registry }).request({ input: 'x' }, { requiredCapabilities: ['text'] });
  assert.equal(result.provider, 'b');
  assert.equal(result.output, 'fallback-ok');
  assert.equal(result.routing.reason, 'fallback-after-failure');
  assert.equal(result.routing.attempts.length, 1);
  assert.equal(result.routing.attempts[0].provider, 'a');
});

test('unhealthy or capability-mismatched model is never used merely to succeed', async () => {
  const registry = createModelRegistry();
  registry.registerProvider('a', createFixtureModelAdapter({ name: 'a' }));
  registry.registerModel({ provider: 'a', id: 'a1', capabilities: ['text'], health: 'UNHEALTHY' });
  const router = createModelRouter({ registry });
  await assert.rejects(router.request({ input: 'x' }, { requiredCapabilities: ['vision'] }), (error) => error.code === 'NO_COMPATIBLE_MODEL');
});

test('model response exposes routing/usage but never provider secret', async () => {
  const { registry } = fixture();
  const result = await createModelRouter({ registry }).request({ input: 'hello' }, { requiredCapabilities: ['text'], pinned: { provider: 'openai', model: 'gpt-x' } });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('oa-secret'), false);
  assert.equal(result.provider, 'openai');
  assert.deepEqual(result.usage, { inputTokens: 1, outputTokens: 1 });
});

test('model classes remain provider-neutral policy labels', async () => {
  const { registry } = fixture();
  const router = createModelRouter({ registry });
  const result = await router.request({ input: 'advanced' }, { requiredCapabilities: ['text'], modelClass: 'advanced', policy: 'cost' });
  assert.ok(['openai','anthropic'].includes(result.provider));
  assert.equal(result.modelClass, 'advanced');
});

test('provider-native tool calls are normalized into inert NaIA call contracts',()=>{
  const calls=normalizeModelToolCalls([
    {id:'c1',function:{name:'note.write',arguments:'{"name":"x","content":"y"}'}},
    {name:'calendar.list',input:{from:'today'}},
  ]);
  assert.deepEqual(calls,[
    {id:'c1',name:'note.write',input:{name:'x',content:'y'}},
    {id:'tool-call-2',name:'calendar.list',input:{from:'today'}},
  ]);
});

test('Free user cannot request advanced model class',async()=>{
  const {registry}=fixture();
  const entitlements=createEntitlementService();
  const engine=createEntitledModelEngine({router:createModelRouter({registry}),entitlements});
  await assert.rejects(
    engine.request({userId:'u1',logicalId:'r1',request:{input:'x'},routing:{modelClass:'advanced',requiredCapabilities:['text']}}),
    (error)=>error.code==='NOT_ENTITLED'&&error.capability==='model.advanced',
  );
});

test('Pro user can request advanced class and usage is metered once per logical request',async()=>{
  const {registry}=fixture();
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const meter=createUsageMeter({entitlements});
  const engine=createEntitledModelEngine({router:createModelRouter({registry}),entitlements,meter});
  const first=await engine.request({userId:'u1',logicalId:'r1',request:{input:'x'},routing:{modelClass:'advanced',requiredCapabilities:['text']},modelUnits:2});
  assert.equal(first.entitlement.capability,'model.advanced');
  assert.equal(first.metering.used,2);
  const second=await engine.request({userId:'u1',logicalId:'r1',request:{input:'x'},routing:{modelClass:'advanced',requiredCapabilities:['text']},modelUnits:2});
  assert.equal(second.metering.code,'ALREADY_COUNTED');
  assert.equal(second.metering.used,2);
});

test('model quota blocks before provider invocation',async()=>{
  let calls=0;
  const registry=createModelRegistry();
  registry.registerProvider('x',{async complete(){calls+=1;return {output:'ok'};}});
  registry.registerModel({provider:'x',id:'m',class:'standard',capabilities:['text']});
  const entitlements=createEntitlementService();
  const meter=createUsageMeter({entitlements});
  await meter.consume({userId:'u1',metric:'modelUnits.monthly',window:'MONTH',amount:100,logicalId:'fill'});
  const engine=createEntitledModelEngine({router:createModelRouter({registry}),entitlements,meter});
  await assert.rejects(engine.request({userId:'u1',logicalId:'blocked',request:{input:'x'},routing:{modelClass:'standard',requiredCapabilities:['text']},modelUnits:1}),(error)=>error.code==='LIMIT_REACHED');
  assert.equal(calls,0);
});

test('fallback provider errors expose code/retryability but not raw provider error messages',async()=>{
  const registry=createModelRegistry();
  registry.registerProvider('a',{async complete(){const e=new Error('Authorization Bearer super-secret');e.code='RATE_LIMIT';e.retryable=true;throw e;}});
  registry.registerProvider('b',createFixtureModelAdapter({name:'b',output:'ok'}));
  registry.registerModel({provider:'a',id:'a1',capabilities:['text'],costRank:1,latencyRank:1});
  registry.registerModel({provider:'b',id:'b1',capabilities:['text'],costRank:2,latencyRank:2});
  const result=await createModelRouter({registry}).request({input:'x'},{requiredCapabilities:['text']});
  assert.equal(JSON.stringify(result).includes('super-secret'),false);
  assert.deepEqual(result.routing.attempts,[{provider:'a',model:'a1',code:'RATE_LIMIT',retryable:true}]);
});
