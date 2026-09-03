export function validatePlan(plan, objectiveId) {
  if (!plan || plan.objectiveId !== objectiveId) throw new Error('planner returned invalid objectiveId');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('planner returned no steps');
  for (const step of plan.steps) {
    if (!step?.id || !step?.kind || !step?.status) throw new Error('planner returned invalid step');
    if (step.action) {
      if (!step.action.capability && !step.action.tool) throw new Error('planner action requires capability');
      if (!step.action.risk) throw new Error('planner action requires risk');
      if (!Array.isArray(step.action.scopes)) step.action.scopes = [];
    }
  }
  return plan;
}

export function createPlannerProvider({ plan }) {
  if (typeof plan !== 'function') throw new Error('planner provider requires plan()');
  return {
    async plan(objective, context = {}) {
      return validatePlan(await plan(objective, context), objective.id);
    },
  };
}
