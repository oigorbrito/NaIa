import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRegistry, createDefaultCapabilityRegistry } from '../../src/product/capabilities.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createToolRegistry } from '../../src/product/tools.mjs';

function capability({ id, prefix, tool, risk = 'READ_ONLY', requiresApproval = false, approvalScope = null }) {
  return {
    id,
    match(intent) {
      if (!intent.startsWith(prefix)) return null;
      return { value: intent.slice(prefix.length).trim() };
    },
    buildAction({ match }) {
      return { tool, input: match, risk, requiresApproval, ...(approvalScope ? { approvalScope } : {}) };
    },
  };
}

test('custom capability and local tool can be added without changing NaIA service', async () => {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(capability({ id: 'fixture.reverse', prefix: 'reverse:', tool: 'fixture.reverse' }));
  const ports = createInMemoryPorts({
    capabilities,
    tools: [{ name: 'fixture.reverse', risk: 'READ_ONLY', async run(input) { return { text: [...input.value].reverse().join('') }; } }],
  });
  const naia = createNaiaService(ports);

  const result = await naia.pursue({ title: 'reverse: naia' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.plan.capabilityId, 'fixture.reverse');
  const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
  assert.equal(evidence.find((row) => row.type === 'STEP_EXECUTED' && row.tool === 'fixture.reverse').output.result.text, 'aian');
});

test('capability registry rejects ambiguous intent resolution', () => {
  const capabilities = createCapabilityRegistry([
    capability({ id: 'fixture.one', prefix: 'same:', tool: 'fixture.one' }),
    capability({ id: 'fixture.two', prefix: 'same:', tool: 'fixture.two' }),
  ]);

  assert.throws(
    () => capabilities.resolve('same: value'),
    (error) => error.code === 'AMBIGUOUS_INTENT',
  );
});

test('tool registry rejects duplicate registration', () => {
  const registry = createToolRegistry();
  assert.throws(
    () => registry.register({ name: 'time.now', risk: 'READ_ONLY', async run() { return {}; } }),
    /already registered/i,
  );
});

test('external execution adapter handles a capability without a local tool', async () => {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(capability({ id: 'fixture.lookup', prefix: 'lookup:', tool: 'external.lookup' }));
  const calls = [];
  const ports = createInMemoryPorts({
    capabilities,
    executionAdapters: [{
      supports: (tool) => tool === 'external.lookup',
      async run(request) {
        calls.push(request.step.action.input);
        return { ok: true, output: { tool: 'external.lookup', result: { value: request.step.action.input.value.toUpperCase() } } };
      },
    }],
  });
  const result = await createNaiaService(ports).pursue({ title: 'lookup: capability' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.deepEqual(calls, [{ value: 'capability' }]);
});

test('missing execution adapter fails closed as permanent failure', async () => {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(capability({ id: 'fixture.missing', prefix: 'missing:', tool: 'external.missing' }));
  const ports = createInMemoryPorts({ capabilities });
  const result = await createNaiaService(ports).pursue({ title: 'missing: capability' });

  assert.equal(result.objective.status, 'FAILED');
  assert.equal(result.objective.retryDisposition, 'PERMANENT');
  assert.match(result.objective.lastError, /tool not found/i);
});

test('multiple external adapters for one tool fail closed', async () => {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(capability({ id: 'fixture.ambiguous-adapter', prefix: 'adapter:', tool: 'external.shared' }));
  const adapter = { supports: (tool) => tool === 'external.shared', async run() { return { ok: true }; } };
  const ports = createInMemoryPorts({ capabilities, executionAdapters: [adapter, adapter] });
  const result = await createNaiaService(ports).pursue({ title: 'adapter: collision' });

  assert.equal(result.objective.status, 'FAILED');
  assert.equal(result.objective.retryDisposition, 'PERMANENT');
  assert.match(result.objective.lastError, /multiple execution adapters/i);
});

test('scoped approval blocks wrong scope and permits only the declared scope', async () => {
  const capabilities = createDefaultCapabilityRegistry();
  capabilities.register(capability({
    id: 'fixture.send',
    prefix: 'send:',
    tool: 'external.send',
    risk: 'EXTERNAL_WRITE',
    requiresApproval: true,
    approvalScope: 'channel:alpha',
  }));
  let dispatches = 0;
  const ports = createInMemoryPorts({
    capabilities,
    executionAdapters: [{
      supports: (tool) => tool === 'external.send',
      async run() { dispatches += 1; return { ok: true, output: { sent: true } }; },
    }],
  });
  const naia = createNaiaService(ports);

  const pending = await naia.pursue({ title: 'send: hello' });
  assert.equal(pending.objective.status, 'WAITING_APPROVAL');
  assert.equal(dispatches, 0);
  assert.equal(pending.authorization.scope, 'channel:alpha');

  await assert.rejects(() => naia.approve(pending.objective.id, 'external.send', 'channel:beta'), /scope mismatch/i);
  assert.equal(dispatches, 0);

  const completed = await naia.approve(pending.objective.id, 'external.send', 'channel:alpha');
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(dispatches, 1);
  assert.deepEqual(completed.objective.approvals, ['external.send::channel:alpha']);

  const evidence = await ports.evidence.list({ objectiveId: pending.objective.id });
  assert.ok(evidence.some((row) => row.type === 'TOOL_APPROVED' && row.scope === 'channel:alpha'));
});
