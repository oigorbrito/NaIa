import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFilePorts } from '../../src/product/file-ports.mjs';
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

test('failed execution stops, persists progress, and resumes from unfinished step', async () => {
  const ports = createInMemoryPorts();
  let calls = 0;
  ports.execution.run = async () => ({ ok: ++calls < 2, output: { calls } });
  const naia = createNaiaService(ports);
  const failed = await naia.pursue({ title: 'Resume visibly' });

  assert.equal(failed.objective.status, 'FAILED');
  assert.equal(failed.plan.steps[0].status, 'COMPLETED');
  assert.equal(failed.plan.steps[1].status, 'FAILED');
  assert.equal(failed.plan.steps[2].status, 'PENDING');

  const resumedKinds = [];
  ports.execution.run = async ({ step }) => {
    resumedKinds.push(step.kind);
    return { ok: true, output: { resumed: true } };
  };
  const resumed = await naia.resume(failed.objective.id);

  assert.equal(resumed.objective.status, 'COMPLETED');
  assert.deepEqual(resumedKinds, ['EXECUTE', 'VERIFY']);
  const evidence = await ports.evidence.list({ objectiveId: failed.objective.id });
  assert.equal(evidence.filter((entry) => entry.type === 'OBJECTIVE_RESUMED').length, 1);
  assert.equal(evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
});

test('file ports preserve objective, plan, and evidence across service instances', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-product-'));
  try {
    const firstPorts = createFilePorts({ rootDir });
    const firstService = createNaiaService(firstPorts);
    const created = await firstService.pursue({ title: 'Persist between processes' });

    const secondPorts = createFilePorts({ rootDir });
    const secondService = createNaiaService(secondPorts);
    const snapshot = await secondService.get(created.objective.id);

    assert.equal(snapshot.objective.status, 'COMPLETED');
    assert.equal(snapshot.plan.steps.length, 3);
    assert.equal(snapshot.evidence[0].type, 'OBJECTIVE_CREATED');
    assert.equal(snapshot.evidence.at(-1).type, 'OBJECTIVE_COMPLETED');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
