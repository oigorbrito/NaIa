export function presentObjective(snapshot) {
  const objective = snapshot?.objective;
  const plan = snapshot?.plan;
  const evidence = Array.isArray(snapshot?.evidence) ? snapshot.evidence : [];
  if (!objective) return { found: false };

  const currentStep = plan?.steps?.find((step) => step.status !== 'COMPLETED') ?? null;
  const lastEvidence = evidence.at(-1) ?? null;
  return {
    found: true,
    id: objective.id,
    title: objective.title,
    status: objective.status,
    currentStep: currentStep ? {
      id: currentStep.id,
      kind: currentStep.kind,
      status: currentStep.status,
      capability: currentStep.action?.capability ?? currentStep.action?.tool ?? null,
      scopes: currentStep.action?.scopes ?? [],
    } : null,
    approvals: objective.approvals ?? [],
    evidenceCount: evidence.length,
    lastEvent: lastEvidence ? {
      type: lastEvidence.type,
      at: lastEvidence.at ?? null,
      capability: lastEvidence.capability ?? lastEvidence.tool ?? null,
    } : null,
    updatedAt: objective.updatedAt,
  };
}
