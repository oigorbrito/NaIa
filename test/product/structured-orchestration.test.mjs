import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { resultRef, validatePlanDependencies } from '../../src/product/orchestration.mjs';

test('downstream step consumes an upstream persisted result reference', async () => {
  const ports = createInMemoryPorts();
  const calls = [];
  ports.tools.register({ name: 'demo.read', risk: 'READ_ONLY', scopes: [], async invoke() { calls.push('read'); return { title: 'Issue 42' }; } });
  ports.tools.register({ name: 'demo.transform', risk: 'READ_ONLY', scopes: [], async invoke(input) { calls.push(input.text); return { text: `Summary: ${input.text}` }; } });
  ports.planner.plan = async (objective) => ({
    objectiveId: objective.id,
    steps: [
      { id: `${objective.id}:a`, kind: 'EXECUTE', status: 'PENDING', action: { capability: 'demo.read', tool: 'demo.read', input: {}, risk: 'READ_ONLY', scopes: [], requiresApproval: false } },
      { id: `${objective.id}:b`, kind: 'EXECUTE', status: 'PENDING', dependsOn: [`${objective.id}:a`], action: { capability: 'demo.transform', tool: 'demo.transform', input: { text: resultRef(`${objective.id}:a`, 'title') }, risk: 'READ_ONLY', scopes: [], requiresApproval: false } },
    ],
  });
  const naia = createNaiaService(ports);
  const completed = await naia.pursue({ title: 'compose results' });
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.deepEqual(calls, ['read', 'Issue 42']);
  const results = await naia.results(completed.objective.id);
  assert.deepEqual(results.at(-1).result, { text: 'Summary: Issue 42' });
});

test('resume reuses upstream STEP_RESULT and does not replay completed producer', async () => {
  const ports = createInMemoryPorts();
  let producerCalls = 0;
  let writerCalls = 0;
  ports.tools.register({ name: 'demo.produce', risk: 'READ_ONLY', scopes: [], async invoke() { producerCalls += 1; return { value: 'persisted-value' }; } });
  ports.tools.register({ name: 'demo.write', risk: 'EXTERNAL_WRITE', scopes: ['demo:write'], async invoke(input) { writerCalls += 1; return { received: input.value }; } });
  ports.planner.plan = async (objective) => ({
    objectiveId: objective.id,
    steps: [
      { id: `${objective.id}:produce`, kind: 'EXECUTE', status: 'PENDING', action: { capability: 'demo.produce', tool: 'demo.produce', input: {}, risk: 'READ_ONLY', scopes: [], requiresApproval: false } },
      { id: `${objective.id}:write`, kind: 'EXECUTE', status: 'PENDING', dependsOn: [`${objective.id}:produce`], action: { capability: 'demo.write', tool: 'demo.write', input: { value: resultRef(`${objective.id}:produce`, 'value') }, risk: 'EXTERNAL_WRITE', scopes: ['demo:write'], requiresApproval: true } },
    ],
  });
  const naia = createNaiaService(ports);
  const pending = await naia.pursue({ title: 'produce then write' });
  assert.equal(pending.objective.status, 'WAITING_APPROVAL');
  assert.equal(producerCalls, 1);
  assert.equal(writerCalls, 0);
  const completed = await naia.approve(pending.objective.id, 'demo.write');
  assert.equal(completed.objective.status, 'COMPLETED');
  assert.equal(producerCalls, 1);
  assert.equal(writerCalls, 1);
  assert.deepEqual((await naia.results(pending.objective.id)).find((item) => item.stepId.endsWith(':write')).result, { received: 'persisted-value' });
});

test('plan validation rejects forward references and missing dependencies', () => {
  assert.throws(() => validatePlanDependencies({ steps: [
    { id: 'a', action: { input: { value: resultRef('b', 'value') } } },
    { id: 'b', action: null },
  ] }), /earlier step/);
  assert.throws(() => validatePlanDependencies({ steps: [
    { id: 'a', dependsOn: ['missing'], action: null },
  ] }), /unknown step dependency/);
});
