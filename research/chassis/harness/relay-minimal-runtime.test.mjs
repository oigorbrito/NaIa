import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileRelayStore, createMemoryRelayStore, createRelayMinimalRuntime } from './relay-minimal-runtime.mjs';
import { createNaiaService } from '../../../src/product/service.mjs';
import { createInMemoryPorts } from '../../../src/product/ports.mjs';

function fixturePorts({ execution }) {
  const runs = createMemoryRelayStore();
  return {
    runs,
    planner: {
      async plan() {
        return {
          steps: [
            { id: 'read', status: 'PENDING', action: { tool: 'read.search', risk: 'READ_ONLY' } },
            {
              id: 'write',
              status: 'PENDING',
              action: { tool: 'note.write', risk: 'LOCAL_WRITE' },
              requiredOutputs: ['receipt.json'],
            },
          ],
        };
      },
    },
    policy: {
      async authorize({ run, step }) {
        if (step.action.risk === 'READ_ONLY') return { allowed: true };
        const allowed = run.approvals.includes(step.action.tool);
        return { allowed, reason: allowed ? null : 'explicit-approval-required' };
      },
    },
    execution,
  };
}

function deterministicIds() {
  let n = 0;
  return () => 'id-' + ++n;
}

test('critical path persists, waits for approval, resumes and completes with event evidence', async () => {
  const calls = [];
  const ports = fixturePorts({
    execution: {
      async run({ step, providerRunId }) {
        calls.push({ stepId: step.id, providerRunId });
        if (step.id === 'read') return { ok: true, output: 'found', usage: { tokens: 10, cost: 0.01 } };
        return {
          ok: true,
          output: 'written',
          files: { 'receipt.json': '{"ok":true}' },
          usage: { tokens: 5, cost: 0.02 },
        };
      },
    },
  });

  const runtime = createRelayMinimalRuntime(ports, {
    idFactory: deterministicIds(),
    now: () => '2026-09-19T00:00:00.000Z',
  });
  const waiting = await runtime.start({ id: 'objective-1', title: 'research then write note' });

  assert.equal(waiting.state, 'WAITING_APPROVAL');
  assert.equal(waiting.plan.steps[0].status, 'COMPLETED');
  assert.equal(waiting.plan.steps[1].status, 'AWAITING_APPROVAL');
  assert.equal(waiting.usage.tokens, 10);
  assert.ok(waiting.events.some((event) => event.event === 'approval_wait_started'));

  const completed = await runtime.approve('objective-1', 'note.write');
  assert.equal(completed.state, 'COMPLETED');
  assert.equal(completed.plan.steps[1].status, 'COMPLETED');
  assert.deepEqual(completed.usage, { tokens: 15, cost: 0.03 });
  assert.ok(completed.events.some((event) => event.event === 'approval_received'));
  assert.ok(completed.events.some((event) => event.event === 'objective_completed'));
  assert.equal(calls.length, 2);
});

test('transient retry preserves provider run identity and accumulates usage', async () => {
  const providerIds = [];
  let attempt = 0;
  const ports = fixturePorts({
    execution: {
      async run({ step, providerRunId }) {
        if (step.id === 'write') return { ok: true, files: { 'receipt.json': 'ok' } };
        providerIds.push(providerRunId);
        attempt += 1;
        if (attempt === 1) return { ok: false, retryable: true, reason: '429', usage: { tokens: 2, cost: 0.01 } };
        return { ok: true, output: 'ok', usage: { tokens: 3, cost: 0.02 } };
      },
    },
  });

  const runtime = createRelayMinimalRuntime(ports, { maxRetries: 1, idFactory: deterministicIds() });
  const waiting = await runtime.start({ id: 'objective-2', title: 'retry test' });

  assert.equal(waiting.state, 'WAITING_APPROVAL');
  assert.equal(waiting.retryCount, 1);
  assert.equal(waiting.restartCount, 0);
  assert.equal(providerIds.length, 2);
  assert.equal(providerIds[0], providerIds[1]);
  assert.deepEqual(waiting.usage, { tokens: 5, cost: 0.03 });
});

test('full restart changes provider run identity while preserving durable NaIA run identity', async () => {
  const providerIds = [];
  let attempt = 0;
  const ports = fixturePorts({
    execution: {
      async run({ step, providerRunId }) {
        if (step.id === 'write') return { ok: true, files: { 'receipt.json': 'ok' } };
        providerIds.push(providerRunId);
        attempt += 1;
        if (attempt === 1) return { ok: false, restartRequired: true, reason: 'provider-run-lost' };
        return { ok: true };
      },
    },
  });

  const runtime = createRelayMinimalRuntime(ports, { maxRestarts: 1, idFactory: deterministicIds() });
  const waiting = await runtime.start({ id: 'objective-3', title: 'restart test' });

  assert.equal(waiting.restartCount, 1);
  assert.equal(providerIds.length, 2);
  assert.notEqual(providerIds[0], providerIds[1]);
  assert.equal(new Set(waiting.events.map((event) => event.runId)).size, 1);
  assert.ok(waiting.events.some((event) => event.event === 'provider_run_restarted'));
});

test('required output contract fails closed when a successful provider response omits output', async () => {
  const ports = fixturePorts({
    execution: {
      async run({ step }) {
        if (step.id === 'read') return { ok: true };
        return { ok: true, files: {} };
      },
    },
  });

  const runtime = createRelayMinimalRuntime(ports, { idFactory: deterministicIds() });
  await runtime.start({ id: 'objective-4', title: 'output contract test' });
  const failed = await runtime.approve('objective-4', 'note.write');

  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.plan.steps[1].status, 'FAILED');
  const event = failed.events.find((row) => row.event === 'required_output_missing');
  assert.deepEqual(event.missing, ['receipt.json']);
});

test('resume does not repeat completed steps after approval-wait persistence', async () => {
  const calls = [];
  const ports = fixturePorts({
    execution: {
      async run({ step }) {
        calls.push(step.id);
        return step.id === 'write' ? { ok: true, files: { 'receipt.json': 'ok' } } : { ok: true };
      },
    },
  });

  const runtime = createRelayMinimalRuntime(ports, { idFactory: deterministicIds() });
  const waiting = await runtime.start({ id: 'objective-5', title: 'resume test' });
  assert.equal(waiting.state, 'WAITING_APPROVAL');

  const resumed = await runtime.resume('objective-5');
  assert.equal(resumed.state, 'WAITING_APPROVAL');
  assert.deepEqual(calls, ['read']);
});

test('file-backed Relay run resumes across runtime restart without repeating completed work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naia-relay-spike-'));
  try {
    const calls = [];
    const execution = {
      async run({ step }) {
        calls.push(step.id);
        return step.id === 'write' ? { ok: true, files: { 'receipt.json': 'ok' } } : { ok: true, usage: { tokens: 2, cost: 0.01 } };
      },
    };
    const firstPorts = fixturePorts({ execution });
    firstPorts.runs = createFileRelayStore({ rootDir: dir });
    const first = createRelayMinimalRuntime(firstPorts, { idFactory: deterministicIds(), now: () => '2026-09-19T15:00:00Z' });
    const waiting = await first.start({ id: 'restart-objective', title: 'restart-safe' });
    assert.equal(waiting.state, 'WAITING_APPROVAL');
    assert.deepEqual(calls, ['read']);
    const durableRunId = waiting.runId;
    const durableProviderRunId = waiting.providerRunId;

    const secondPorts = fixturePorts({ execution });
    secondPorts.runs = createFileRelayStore({ rootDir: dir });
    const second = createRelayMinimalRuntime(secondPorts, { idFactory: deterministicIds(), now: () => '2026-09-19T15:01:00Z' });
    const completed = await second.approve('restart-objective', 'note.write');
    assert.equal(completed.state, 'COMPLETED');
    assert.equal(completed.runId, durableRunId);
    assert.equal(completed.providerRunId, durableProviderRunId);
    assert.deepEqual(calls, ['read', 'write']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Relay confirmation then approval ordering matches current product runtime semantics', async () => {
  const relayCalls = [];
  const runs = createMemoryRelayStore();
  const relayPorts = {
    runs,
    planner: {
      async plan({ id }) {
        return { objectiveId: id, steps: [
          { id: `${id}:execute`, status: 'PENDING', confirmation: { required: true, id: 'confirm-1', payload: { itemIds: ['a'] } }, action: { tool: 'note.write', risk: 'LOCAL_WRITE', input: { name: 'x', content: 'y' } } },
        ] };
      },
    },
    policy: { async authorize({ run, step }) { return { allowed: run.approvals.includes(step.action.tool), reason: 'approval-required' }; } },
    execution: { async run(){ relayCalls.push('executed'); return { ok: true }; } },
  };
  const relay = createRelayMinimalRuntime(relayPorts, { idFactory: deterministicIds(), now: () => '2026-09-19T15:00:00Z' });
  const relayConfirm = await relay.start({ id: 'relay-compat', title: 'confirmed write' });
  assert.equal(relayConfirm.state, 'WAITING_CONFIRMATION');
  assert.equal(relayCalls.length, 0);
  const relayApproval = await relay.confirm('relay-compat', 'confirm-1');
  assert.equal(relayApproval.state, 'WAITING_APPROVAL');
  assert.equal(relayCalls.length, 0);
  const relayDone = await relay.approve('relay-compat', 'note.write');
  assert.equal(relayDone.state, 'COMPLETED');
  assert.equal(relayCalls.length, 1);

  const ports = createInMemoryPorts();
  let productCalls = 0;
  ports.tools.register('compat.write', { risk: 'LOCAL_WRITE', async run(){ productCalls += 1; return { ok: true }; } });
  const product = createNaiaService(ports);
  const productConfirm = await product.pursueAction({
    id: 'product-compat', title: 'confirmed write',
    confirmation: { required: true, id: 'confirm-1', payload: { itemIds: ['a'] } },
    action: { tool: 'compat.write', risk: 'LOCAL_WRITE', requiresApproval: true, input: {} },
  });
  assert.equal(productConfirm.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(productCalls, 0);
  const productApproval = await product.confirm('product-compat', 'confirm-1');
  assert.equal(productApproval.objective.status, 'WAITING_APPROVAL');
  assert.equal(productCalls, 0);
  const productDone = await product.approve('product-compat', 'compat.write');
  assert.equal(productDone.objective.status, 'COMPLETED');
  assert.equal(productCalls, 1);
});

test('Relay confirmation mismatch fails closed', async () => {
  const ports = {
    runs: createMemoryRelayStore(),
    planner: { async plan({ id }) { return { objectiveId: id, steps: [{ id: 'write', status: 'PENDING', confirmation: { required: true, id: 'right' }, action: { tool: 'note.write', risk: 'LOCAL_WRITE' } }] }; } },
    policy: { async authorize(){ return { allowed: false }; } },
    execution: { async run(){ throw new Error('must not execute'); } },
  };
  const runtime = createRelayMinimalRuntime(ports, { idFactory: deterministicIds() });
  await runtime.start({ id: 'confirm-mismatch', title: 'x' });
  await assert.rejects(runtime.confirm('confirm-mismatch', 'wrong'), (error) => error.code === 'CONFIRMATION_MISMATCH');
});
