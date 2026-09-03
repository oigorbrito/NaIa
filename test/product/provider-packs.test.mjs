import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectorGateway } from '../../src/product/connectors.mjs';
import { createGatewayProviderPackCapabilities, assertProviderCapabilityManifest, providerCapabilitySchema } from '../../src/product/provider-pack-adapter.mjs';
import { findProviderCapability, listProviderPacks, validateCapabilityInput } from '../../src/product/provider-packs.mjs';

test('provider packs expose GitHub, Gmail, and Calendar capability groups', () => {
  const packs = listProviderPacks();
  assert.deepEqual(packs.map((pack) => pack.id), ['github.core', 'gmail.core', 'google-calendar.core']);
  assert.ok(packs.find((pack) => pack.id === 'github.core').capabilities.includes('github.issue.create'));
  assert.ok(packs.find((pack) => pack.id === 'gmail.core').capabilities.includes('gmail.message.send'));
  assert.ok(packs.find((pack) => pack.id === 'google-calendar.core').capabilities.includes('calendar.event.create'));
});

test('provider input validation rejects malformed external writes before invocation', () => {
  const send = findProviderCapability('gmail.message.send');
  assert.throws(() => validateCapabilityInput(send, { to: [], subject: 'x', body: 'y' }), /at least 1/);
  assert.throws(() => validateCapabilityInput(send, { to: ['a@example.com'], body: 'missing subject' }), /subject is required/);
  assert.deepEqual(validateCapabilityInput(send, { to: ['a@example.com'], subject: 'Hi', body: 'Body' }), { to: ['a@example.com'], subject: 'Hi', body: 'Body' });
});

test('calendar capability validates date-time and rejects unknown input fields', () => {
  const create = findProviderCapability('calendar.event.create');
  assert.throws(() => validateCapabilityInput(create, { summary: 'Review', start: 'not-a-date', end: '2026-09-04T13:00:00Z' }), /date-time/);
  assert.throws(() => validateCapabilityInput(create, { summary: 'Review', start: '2026-09-04T12:00:00Z', end: '2026-09-04T13:00:00Z', rawToken: 'nope' }), /not allowed/);
});

test('provider gateway adapter validates then invokes through connector gateway', async () => {
  const calls = [];
  const gateway = createConnectorGateway({
    baseUrl: 'https://gateway.test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const capabilities = createGatewayProviderPackCapabilities({ gateway });
  const createIssue = capabilities.find((item) => item.name === 'github.issue.create');
  const result = await createIssue.invoke({ repository: 'tihotm/NaIa', title: 'Provider pack' }, { objective: { id: 'o1' }, step: { id: 's1' } });
  assert.equal(result.ok, true);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.capability, 'github.issue.create');
  assert.equal(payload.context.objectiveId, 'o1');
});

test('gateway manifest compatibility check detects missing capabilities and scope drift', () => {
  const expected = findProviderCapability('github.issue.read');
  const results = assertProviderCapabilityManifest([{ name: expected.name, risk: expected.risk, scopes: [] }]);
  const issueRead = results.find((item) => item.name === expected.name);
  assert.equal(issueRead.available, true);
  assert.equal(issueRead.compatible, false);
  assert.deepEqual(issueRead.missingScopes, ['github:issues:read']);
  assert.ok(results.some((item) => item.available === false));
});

test('provider schema is inspectable for UI and planner surfaces', () => {
  const schema = providerCapabilitySchema('github.issue.read');
  assert.deepEqual(schema.required, ['repository', 'issue']);
  assert.equal(schema.properties.issue.type, 'integer');
});
