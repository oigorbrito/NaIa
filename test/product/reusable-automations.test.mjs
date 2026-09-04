import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { AutomationTriggerKind, instantiateAutomationWorkflow } from '../../src/product/automations.mjs';

test('disabled reusable automation cannot run; enabled manual run becomes confirmation proposal', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const saved = await naia.createAutomation({
    id: 'echo-template',
    name: 'Echo template',
    enabled: false,
    trigger: { kind: AutomationTriggerKind.MANUAL },
    parameters: { text: { required: true } },
    workflow: {
      id: 'echo-template-workflow',
      steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text: { $param: 'text' } } }],
    },
  });
  assert.equal(saved.enabled, false);
  await assert.rejects(() => naia.runAutomation(saved.id, { text: 'hello' }), /disabled/);
  await naia.setAutomationEnabled(saved.id, true);
  const proposed = await naia.runAutomation(saved.id, { text: 'hello' });
  assert.equal(proposed.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(proposed.plan.automation.id, saved.id);
  assert.equal(proposed.plan.automation.parameters.text, 'hello');
  const completed = await naia.confirm(proposed.objective.id);
  assert.equal(completed.objective.status, 'COMPLETED');
  const results = await naia.results(proposed.objective.id);
  assert.ok(results.some((entry) => entry.result === 'hello' || entry.result?.text === 'hello'));
});

test('schedule automation rejects manual trigger and accepts matching schedule trigger as proposal', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const saved = await naia.createAutomation({
    id: 'daily-echo',
    name: 'Daily echo',
    enabled: true,
    trigger: { kind: AutomationTriggerKind.SCHEDULE, schedule: '0 9 * * *', timezone: 'America/Sao_Paulo' },
    parameters: { text: { default: 'daily' } },
    workflow: {
      id: 'daily-echo-workflow',
      steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text: { $param: 'text' } } }],
    },
  });
  await assert.rejects(() => naia.runAutomation(saved.id), /trigger mismatch/);
  const proposed = await naia.triggerAutomation(saved.id, { kind: AutomationTriggerKind.SCHEDULE }, {});
  assert.equal(proposed.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(proposed.plan.automation.trigger.kind, 'SCHEDULE');
});

test('automation parameters are strict and resolve recursively', () => {
  const automation = {
    parameters: { repository: { required: true }, issue: { default: 1 } },
    workflow: {
      id: 'parameterized',
      steps: [{ id: 'shape', kind: 'TRANSFORM', value: { repository: { $param: 'repository' }, nested: [{ issue: { $param: 'issue' } }] } }],
    },
  };
  const instantiated = instantiateAutomationWorkflow(automation, { repository: 'tihotm/NaIa' });
  assert.equal(instantiated.workflow.steps[0].value.repository, 'tihotm/NaIa');
  assert.equal(instantiated.workflow.steps[0].value.nested[0].issue, 1);
  assert.throws(() => instantiateAutomationWorkflow(automation, { repository: 'x', extra: true }), /unknown automation parameter/);
});

test('event trigger validates event identity', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({
    id: 'issue-opened', name: 'Issue opened', enabled: true,
    trigger: { kind: AutomationTriggerKind.EVENT, event: 'github.issue.opened', source: 'github' },
    workflow: { id: 'issue-opened-workflow', steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text: 'event' } }] },
  });
  await assert.rejects(() => naia.triggerAutomation('issue-opened', { kind: 'EVENT', event: 'github.issue.closed' }), /event mismatch/);
  const proposed = await naia.triggerAutomation('issue-opened', { kind: 'EVENT', event: 'github.issue.opened' });
  assert.equal(proposed.objective.status, 'WAITING_CONFIRMATION');
});
