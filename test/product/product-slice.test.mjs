import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

test('pursue executes objective through evidence-backed plan', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title: 'Ship first NaIA slice' });

  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.plan.steps.length, 3);
  assert.ok(result.plan.steps.every((step) => step.status === 'COMPLETED'));

  const stored = await ports.objectives.get(result.objective.id);
  assert.equal(stored.status, 'COMPLETED');

  const evidence = await ports.evidence.list();
  assert.equal(evidence[0].type, 'OBJECTIVE_CREATED');
  assert.equal(evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
  assert.equal(evidence.filter((entry) => entry.type === 'STEP_EXECUTED').length, 3);
});

test('failed execution stops the objective and preserves evidence', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => ({ ok: ++calls < 2, output: { calls } });
  const naia = createNaiaService(ports);
  const result = await naia.pursue({ title: 'Fail visibly' });

  assert.equal(result.objective.status, 'FAILED');
  assert.equal(result.plan.steps[0].status, 'COMPLETED');
  assert.equal(result.plan.steps[1].status, 'FAILED');
  assert.equal(result.plan.steps[2].status, 'PENDING');
  const evidence = await ports.evidence.list();
  assert.equal(evidence.filter((entry) => entry.type === 'STEP_EXECUTED').length, 2);
});
