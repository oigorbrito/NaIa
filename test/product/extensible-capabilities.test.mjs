import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createPlannerProvider } from '../../src/product/planner-provider.mjs';
import { CapabilityRisk } from '../../src/product/capabilities.mjs';
import { presentObjective } from '../../src/product/presenter.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('injected capability participates in planning and execution', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-capability-'));
  try {
    const capability = {
      name: 'math.double',
      risk: CapabilityRisk.READ_ONLY,
      scopes: ['math:compute'],
      description: 'Double a numeric value.',
      source: 'test-adapter',
      async invoke(input) { return { value: Number(input.value) * 2 }; },
    };
    const planner = createPlannerProvider({
      async plan(objective) {
        return {
          objectiveId: objective.id,
          intent: objective.title,
          steps: [{
            id: `${objective.id}:execute`,
            kind: 'EXECUTE',
            status: 'PENDING',
            action: {
              capability: 'math.double',
              tool: 'math.double',
              input: { value: 21 },
              risk: CapabilityRisk.READ_ONLY,
              scopes: ['math:compute'],
              requiresApproval: false,
            },
          }],
        };
      },
    });
    const ports = createFilePorts({ rootDir, capabilities: [capability], planner });
    const naia = createNaiaService(ports);
    const result = await naia.pursue({ title: 'double 21' });

    assert.equal(result.objective.status, 'COMPLETED');
    const evidence = await ports.evidence.list({ objectiveId: result.objective.id });
    const executed = evidence.find((entry) => entry.type === 'STEP_EXECUTED');
    assert.equal(executed.output.result.value, 42);
    assert.equal(ports.tools.describe('math.double').source, 'test-adapter');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('side-effect approval is scoped to capability permissions', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'naia-scope-'));
  try {
    const ports = createFilePorts({ rootDir });
    const naia = createNaiaService(ports);
    const waiting = await naia.pursue({ title: 'note plan: scoped approval' });

    assert.equal(waiting.objective.status, 'WAITING_APPROVAL');
    assert.deepEqual(waiting.authorization.scopes, ['workspace:notes:write']);

    const completed = await naia.approve(waiting.objective.id, 'note.write');
    assert.equal(completed.objective.status, 'COMPLETED');
    assert.deepEqual(completed.objective.approvals, [{
      capability: 'note.write',
      scopes: ['workspace:notes:write'],
    }]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('planner provider rejects malformed plans', async () => {
  const planner = createPlannerProvider({ async plan() { return { objectiveId: 'wrong', steps: [] }; } });
  await assert.rejects(() => planner.plan({ id: 'expected' }), /invalid objectiveId/);
});

test('presenter exposes concise current objective state', () => {
  const output = presentObjective({
    objective: { id: 'o1', title: 'demo', status: 'WAITING_APPROVAL', approvals: [], updatedAt: '2026-09-03T00:00:00Z' },
    plan: { steps: [{ id: 's1', kind: 'EXECUTE', status: 'AWAITING_APPROVAL', action: { capability: 'note.write', scopes: ['workspace:notes:write'] } }] },
    evidence: [{ type: 'APPROVAL_REQUIRED', capability: 'note.write', at: '2026-09-03T00:00:00Z' }],
  });
  assert.equal(output.currentStep.capability, 'note.write');
  assert.equal(output.lastEvent.type, 'APPROVAL_REQUIRED');
  assert.equal(output.evidenceCount, 1);
});
