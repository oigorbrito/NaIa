import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectorGateway, createGatewayCapabilities } from '../../src/product/connectors.mjs';
import { createConnectorAwarePlanner, parseCapabilityIntent } from '../../src/product/connector-planner.mjs';
import { createDeterministicPlanner } from '../../src/product/planner.mjs';
import { createToolRegistry } from '../../src/product/tools.mjs';

test('connector gateway discovers and invokes external capabilities', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/capabilities')) {
      return new Response(JSON.stringify({ capabilities: [{ name: 'github.issue.read', risk: 'READ_ONLY', scopes: ['github:issues:read'] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ issue: 42 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const capabilities = await createGatewayCapabilities({ baseUrl: 'https://gateway.test', token: 'secret', fetchImpl });
  assert.equal(capabilities[0].name, 'github.issue.read');
  const result = await capabilities[0].invoke({ repo: 'tihotm/NaIa', issue: 42 }, {});
  assert.equal(result.issue, 42);
  assert.equal(calls[1].init.headers.authorization, 'Bearer secret');
});

test('connector-aware planner routes explicit capability intent using registry metadata', async () => {
  const registry = createToolRegistry({ capabilities: [{ name: 'github.issue.read', risk: 'READ_ONLY', scopes: ['github:issues:read'], source: 'connector-gateway', async invoke() { return {}; } }] });
  const planner = createConnectorAwarePlanner({ fallbackPlanner: createDeterministicPlanner() });
  const objective = { id: 'o1', title: 'use github.issue.read {"issue":42}' };
  const plan = await planner.plan(objective, { capabilities: registry });
  assert.equal(plan.steps[1].action.capability, 'github.issue.read');
  assert.deepEqual(plan.steps[1].action.input, { issue: 42 });
  assert.deepEqual(plan.steps[1].action.scopes, ['github:issues:read']);
});

test('explicit capability intent parser validates object JSON', () => {
  assert.deepEqual(parseCapabilityIntent('use text.echo {"text":"hi"}'), { capability: 'text.echo', input: { text: 'hi' } });
  assert.throws(() => parseCapabilityIntent('use text.echo [1,2]'), /input must be an object/);
});

test('connector gateway surfaces remote failures', async () => {
  const gateway = createConnectorGateway({
    baseUrl: 'https://gateway.test',
    fetchImpl: async () => new Response('denied', { status: 403, statusText: 'Forbidden' }),
  });
  await assert.rejects(() => gateway.manifest(), /connector gateway 403/);
});
