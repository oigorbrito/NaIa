import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createProviderPackCapabilities } from '../../src/product/provider-pack-adapter.mjs';
import { createProviderAwarePlanner } from '../../src/product/provider-aware-planner.mjs';
import { planIntent } from '../../src/product/planner.mjs';
import { ConnectionStatus, evaluateCapabilityAvailability } from '../../src/product/connection-state.mjs';

test('provider capability is unavailable while disconnected and when scopes are missing', () => {
  const capability = { provider: 'github', scopes: ['github:issues:read'] };
  assert.equal(evaluateCapabilityAvailability(capability, null).reason, 'provider-disconnected');
  const missing = evaluateCapabilityAvailability(capability, { status: ConnectionStatus.CONNECTED, grantedScopes: [] });
  assert.equal(missing.available, false);
  assert.deepEqual(missing.missingScopes, ['github:issues:read']);
});

test('objective waits for connection and resumes after provider becomes available', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-connection-'));
  const calls = [];
  try {
    const capabilities = createProviderPackCapabilities({ async invoke(name, input) { calls.push({ name, input }); return { ok: true }; } });
    const planner = createProviderAwarePlanner({ fallbackPlanner: { async plan(objective, context) { return planIntent(objective, context); } } });
    const ports = createFilePorts({ rootDir, capabilities, planner });
    const naia = createNaiaService(ports);

    const pending = await naia.pursue({ title: 'github issue {"repository":"tihotm/NaIa","issue":6}' });
    assert.equal(pending.objective.status, 'WAITING_CONNECTION');
    assert.equal(calls.length, 0);

    await naia.setConnection({ provider: 'github', status: 'CONNECTED', grantedScopes: ['github:issues:read'] });
    const resumed = await naia.resume(pending.objective.id);
    assert.equal(resumed.objective.status, 'COMPLETED');
    assert.equal(calls[0].name, 'github.issue.read');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('multi-provider plan executes reads then pauses for write approval', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-multiprovider-'));
  const calls = [];
  try {
    const capabilities = createProviderPackCapabilities({ async invoke(name, input) { calls.push({ name, input }); return { ok: true }; } });
    const planner = createProviderAwarePlanner({ fallbackPlanner: { async plan(objective, context) { return planIntent(objective, context); } } });
    const ports = createFilePorts({ rootDir, capabilities, planner });
    const naia = createNaiaService(ports);
    await naia.setConnection({ provider: 'github', status: 'CONNECTED', grantedScopes: ['github:issues:read'] });
    await naia.setConnection({ provider: 'gmail', status: 'CONNECTED', grantedScopes: ['gmail:messages:send'] });

    const title = 'github issue {"repository":"tihotm/NaIa","issue":6} then send email {"to":["a@example.com"],"subject":"Update","body":"Done"}';
    const pending = await naia.pursue({ title });
    assert.equal(pending.objective.status, 'WAITING_APPROVAL');
    assert.deepEqual(calls.map((call) => call.name), ['github.issue.read']);

    const completed = await naia.approve(pending.objective.id, 'gmail.message.send');
    assert.equal(completed.objective.status, 'COMPLETED');
    assert.deepEqual(calls.map((call) => call.name), ['github.issue.read', 'gmail.message.send']);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('connection state persists across service instances', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-connection-persist-'));
  try {
    const first = createNaiaService(createFilePorts({ rootDir }));
    await first.setConnection({ provider: 'gmail', status: 'PERMISSION_MISSING', missingScopes: ['gmail:messages:send'] });
    const second = createNaiaService(createFilePorts({ rootDir }));
    const states = await second.connections();
    assert.equal(states[0].provider, 'gmail');
    assert.equal(states[0].status, 'PERMISSION_MISSING');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
