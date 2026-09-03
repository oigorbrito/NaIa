import { createObjective, createPlan, ObjectiveStatus } from './domain.mjs';
import { assertProductPorts } from './ports.mjs';

async function executePlan(ports, objective, plan) {
  objective.status = ObjectiveStatus.RUNNING;
  objective.updatedAt = new Date().toISOString();
  await ports.objectives.save(objective);

  for (const step of plan.steps) {
    if (step.status === 'COMPLETED') continue;
    step.status = 'RUNNING';
    await ports.plans.save(plan);

    const result = await ports.execution.run({ objective, plan, step });
    step.status = result?.ok ? 'COMPLETED' : 'FAILED';
    await ports.plans.save(plan);
    await ports.evidence.append({
      type: 'STEP_EXECUTED',
      objectiveId: objective.id,
      stepId: step.id,
      kind: step.kind,
      ok: Boolean(result?.ok),
      output: result?.output ?? null,
      at: new Date().toISOString(),
    });

    if (!result?.ok) {
      objective.status = ObjectiveStatus.FAILED;
      objective.updatedAt = new Date().toISOString();
      await ports.objectives.save(objective);
      return { objective, plan };
    }
  }

  objective.status = ObjectiveStatus.COMPLETED;
  objective.updatedAt = new Date().toISOString();
  await ports.objectives.save(objective);
  await ports.evidence.append({ type: 'OBJECTIVE_COMPLETED', objectiveId: objective.id, at: objective.updatedAt });
  return { objective, plan };
}

export function createNaiaService(rawPorts) {
  const ports = assertProductPorts(rawPorts);

  return {
    async pursue(input) {
      const objective = createObjective(input);
      const plan = createPlan(objective);
      await ports.objectives.save(objective);
      await ports.plans.save(plan);
      await ports.evidence.append({ type: 'OBJECTIVE_CREATED', objectiveId: objective.id, at: objective.createdAt });
      return executePlan(ports, objective, plan);
    },

    async resume(objectiveId) {
      const objective = await ports.objectives.get(objectiveId);
      if (!objective) throw new Error(`objective not found: ${objectiveId}`);
      if (objective.status === ObjectiveStatus.COMPLETED) {
        return { objective, plan: await ports.plans.get(objectiveId) };
      }

      const plan = await ports.plans.get(objectiveId);
      if (!plan) throw new Error(`plan not found for objective: ${objectiveId}`);
      await ports.evidence.append({ type: 'OBJECTIVE_RESUMED', objectiveId, at: new Date().toISOString() });
      return executePlan(ports, objective, plan);
    },

    async get(objectiveId) {
      return {
        objective: await ports.objectives.get(objectiveId),
        plan: await ports.plans.get(objectiveId),
        evidence: typeof ports.evidence.list === 'function' ? await ports.evidence.list({ objectiveId }) : [],
      };
    },
  };
}
