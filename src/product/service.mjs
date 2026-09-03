import { createObjective, createPlan, ObjectiveStatus } from './domain.mjs';
import { assertProductPorts } from './ports.mjs';

export function createNaiaService(rawPorts) {
  const ports = assertProductPorts(rawPorts);

  return {
    async pursue(input) {
      const objective = createObjective(input);
      const plan = createPlan(objective);
      await ports.objectives.save(objective);
      await ports.evidence.append({ type: 'OBJECTIVE_CREATED', objectiveId: objective.id, at: objective.createdAt });

      objective.status = ObjectiveStatus.RUNNING;
      objective.updatedAt = new Date().toISOString();
      await ports.objectives.save(objective);

      for (const step of plan.steps) {
        step.status = 'RUNNING';
        const result = await ports.execution.run({ objective, plan, step });
        step.status = result?.ok ? 'COMPLETED' : 'FAILED';
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
    },
  };
}
