import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { AutomationTriggerKind } from '../../src/product/automations.mjs';
import {
  createAutomationRunStore,
  createAutomationTriggerRuntime,
  createTriggerAdapterRegistry,
  deriveIdempotencyKey,
} from '../../src/product/trigger-runtime.mjs';

test('schedule adapter normalizes delivery and duplicate idempotency key produces one run', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({
    id: 'daily-echo', name: 'Daily echo', enabled: true,
    trigger: { kind: AutomationTriggerKind.SCHEDULE, schedule: '0 9 * * *', timezone: 'America/Sao_Paulo' },
    parameters: { text: { default: 'daily' } },
    workflow: { id: 'daily-echo-workflow', steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text: { $param: 'text' } } }] },
  });
  const runs = createAutomationRunStore();
  const runtime = createAutomationTriggerRuntime({ naia, runs });
  const delivery = {
    automationId: 'daily-echo',
    trigger: { kind: 'SCHEDULE' },
    scheduledFor: '2026-09-04T09:00:00-03:00',
    parameters: { text: 'hello' },
    idempotencyKey: 'schedule:daily-echo:2026-09-04T09:00:00-03:00',
  };
  const first = await runtime.dispatch(delivery);
  const second = await runtime.dispatch(delivery);
  assert.equal(first.deduplicated, false);
  assert.equal(first.run.status, 'WAITING_CONFIRMATION');
  assert.equal(first.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(second.deduplicated, true);
  assert.equal(second.run.id, first.run.id);
  const history = await runtime.history('daily-echo');
  assert.equal(history.length, 1);
});

test('event adapter requires eventId and records rejected deliveries', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({
    id: 'issue-opened', name: 'Issue opened', enabled: true,
    trigger: { kind: AutomationTriggerKind.EVENT, event: 'github.issue.opened', source: 'github' },
    workflow: { id: 'issue-opened-workflow', steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text: 'event' } }] },
  });
  const runs = createAutomationRunStore();
  const runtime = createAutomationTriggerRuntime({ naia, runs });
  await assert.rejects(() => runtime.dispatch({ automationId: 'issue-opened', trigger: { kind: 'EVENT', event: 'github.issue.opened' } }), /eventId/);
  await assert.rejects(() => runtime.dispatch({
    automationId: 'issue-opened', trigger: { kind: 'EVENT', event: 'github.issue.closed' }, eventId: 'evt-1', idempotencyKey: 'evt-1',
  }), /event mismatch/);
  const history = await runtime.history('issue-opened');
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'REJECTED');
  assert.match(history[0].error, /event mismatch/);
});

test('derived idempotency keys are stable for equivalent delivery objects', () => {
  const left = deriveIdempotencyKey({ automationId: 'a', trigger: { kind: 'EVENT', eventId: 'x', event: 'e' }, parameters: { b: 2, a: 1 } });
  const right = deriveIdempotencyKey({ parameters: { a: 1, b: 2 }, trigger: { event: 'e', eventId: 'x', kind: 'EVENT' }, automationId: 'a' });
  assert.equal(left, right);
});

test('runtime exposes built-in manual, schedule, and event adapters', () => {
  const registry = createTriggerAdapterRegistry();
  assert.deepEqual(new Set(registry.kinds()), new Set(['MANUAL', 'SCHEDULE', 'EVENT']));
});
