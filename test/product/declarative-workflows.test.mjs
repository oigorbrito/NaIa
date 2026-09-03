import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { CapabilityRisk } from '../../src/product/capabilities.mjs';
import { WorkflowStepKind, validateWorkflowDefinition } from '../../src/product/workflows.mjs';

test('condition executes selected branch and marks the other branch skipped', async () => {
  const ports = createInMemoryPorts();
  const calls = [];
  ports.tools.register({ name: 'test.capture', risk: CapabilityRisk.READ_ONLY, scopes: [], async invoke(input) { calls.push(input); return input; } });
  const naia = createNaiaService(ports);
  const result = await naia.runWorkflow({
    id: 'branching',
    steps: [
      { id: 'seed', kind: WorkflowStepKind.TRANSFORM, value: { score: 7 } },
      { id: 'gate', kind: WorkflowStepKind.CONDITION, dependsOn: ['seed'], when: { left: { $result: { stepId: 'seed', path: 'score' } }, op: 'gte', right: 5 }, then: ['high'], else: ['low'] },
      { id: 'high', kind: WorkflowStepKind.ACTION, dependsOn: ['gate'], capability: 'test.capture', input: { branch: 'high' } },
      { id: 'low', kind: WorkflowStepKind.ACTION, dependsOn: ['gate'], capability: 'test.capture', input: { branch: 'low' } },
    ],
  });
  assert.equal(result.objective.status, 'COMPLETED');
  assert.deepEqual(calls, [{ branch: 'high' }]);
  const low = result.plan.steps.find((step) => step.workflow?.sourceId === 'low');
  assert.equal(low.status, 'SKIPPED');
  const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
  assert.ok(evidence.some((entry) => entry.type === 'CONDITION_EVALUATED' && entry.result === true));
});

test('transform feeds fan-out children and fan-in aggregates their persisted results', async () => {
  const ports = createInMemoryPorts();
  ports.tools.register({ name: 'test.echo', risk: CapabilityRisk.READ_ONLY, scopes: [], async invoke(input) { return { echoed: input.value }; } });
  const naia = createNaiaService(ports);
  const result = await naia.runWorkflow({
    id: 'fan-workflow',
    steps: [
      { id: 'seed', kind: WorkflowStepKind.TRANSFORM, value: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] },
      { id: 'fan', kind: WorkflowStepKind.FAN_OUT, dependsOn: ['seed'], capability: 'test.echo', items: { $result: { stepId: 'seed' } }, input: { value: { $item: 'value' } }, concurrency: 3 },
      { id: 'join', kind: WorkflowStepKind.FAN_IN, dependsOn: ['fan'], from: ['fan'] },
    ],
  });
  assert.equal(result.objective.status, 'COMPLETED');
  const fan = result.plan.steps.find((step) => step.workflow?.sourceId === 'fan');
  const children = result.plan.steps.filter((step) => step.workflow?.fanOutParent === fan.id);
  assert.equal(children.length, 3);
  assert.ok(children.every((step) => step.status === 'COMPLETED'));
  const results = await naia.results(result.objective.id);
  const join = result.plan.steps.find((step) => step.workflow?.sourceId === 'join');
  const joined = results.find((entry) => entry.stepId === join.id).result;
  assert.deepEqual(joined.map((entry) => entry.result.echoed), ['a', 'b', 'c']);
});

test('fan-out external write pauses for approval and resumes without replaying transform', async () => {
  const ports = createInMemoryPorts();
  let writes = 0;
  ports.tools.register({ name: 'test.write', risk: CapabilityRisk.EXTERNAL_WRITE, scopes: ['test:write'], async invoke(input) { writes += 1; return input; } });
  const naia = createNaiaService(ports);
  const pending = await naia.runWorkflow({
    id: 'approved-fanout',
    steps: [
      { id: 'seed', kind: WorkflowStepKind.TRANSFORM, value: ['x', 'y'] },
      { id: 'fan', kind: WorkflowStepKind.FAN_OUT, dependsOn: ['seed'], capability: 'test.write', items: { $result: { stepId: 'seed' } }, input: { value: { $item: '' } } },
      { id: 'join', kind: WorkflowStepKind.FAN_IN, dependsOn: ['fan'], from: ['fan'] },
    ],
  });
  assert.equal(pending.objective.status, 'WAITING_APPROVAL');
  assert.equal(writes, 0);
  const before = await naia.results(pending.objective.id);
  assert.ok(before.some((entry) => entry.stepId.endsWith(':seed')));
  const completed = await naia.approve(pending.objective.id, 'test.write');
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(writes, 2);
  const evidence = await ports.evidence.list({ objectiveId: pending.objective.id });
  assert.equal(evidence.filter((entry) => entry.type === 'TRANSFORM_APPLIED').length, 1);
});

test('workflow validator rejects dependency cycles', () => {
  assert.throws(() => validateWorkflowDefinition({
    id: 'cycle',
    steps: [
      { id: 'a', kind: WorkflowStepKind.TRANSFORM, dependsOn: ['b'], value: 1 },
      { id: 'b', kind: WorkflowStepKind.TRANSFORM, dependsOn: ['a'], value: 2 },
    ],
  }), /cycle detected/);
});
