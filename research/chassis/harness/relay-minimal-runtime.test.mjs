import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRelayStore, createRelayMinimalRuntime } from './relay-minimal-runtime.mjs';

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
