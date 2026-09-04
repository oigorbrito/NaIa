export function summarizeAutomationPlan(plan = {}) {
  const steps = (plan.steps ?? []).filter((step) => step.action);
  const writes = steps.filter((step) => step.action?.requiresApproval);
  const providers = [...new Set(steps.map((step) => step.action?.provider).filter(Boolean))];
  return {
    workflowId: plan.workflowId ?? null,
    authored: Boolean(plan.authored),
    stepCount: steps.length,
    providers,
    writes: writes.map((step) => ({
      stepId: step.id,
      capability: step.action.capability ?? step.action.tool,
      risk: step.action.risk,
      scopes: step.action.scopes ?? [],
    })),
    steps: steps.map((step) => ({
      id: step.id,
      capability: step.action.capability ?? step.action.tool,
      risk: step.action.risk,
      scopes: step.action.scopes ?? [],
      dependsOn: step.dependsOn ?? [],
    })),
    confirmationRequired: true,
  };
}

export function presentAutomationProposal(snapshot = {}) {
  const objective = snapshot.objective;
  const plan = snapshot.plan;
  if (!objective || !plan) return { found: false };
  return {
    found: true,
    objectiveId: objective.id,
    title: objective.title,
    status: objective.status,
    proposal: summarizeAutomationPlan(plan),
    confirmCommand: `confirm ${objective.id}`,
  };
}
