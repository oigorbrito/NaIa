import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureModelAdapter, createModelRegistry, createModelRouter } from '../../src/product/model-engine.mjs';

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
