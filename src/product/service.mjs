import { approveCapability, createObjective, ObjectiveStatus } from './domain.mjs';
import { assertProductPorts } from './ports.mjs';
import { evaluateCapabilityAvailability } from './connection-state.mjs';

async function refreshConnectionAvailability(ports, step) {
  if (!step.action) return { available: true, reason: 'control-step', missingScopes: [] };
  const capabilityName = step.action.capability ?? step.action.tool;
  const descriptor = ports.tools?.describe?.(capabilityName);
  if (!descriptor?.provider) return { available: true, reason: 'local-capability', missingScopes: [] };
  const connection = await ports.connections.get(descriptor.provider);
  const availability = evaluateCapabilityAvailability(descriptor, connection);
  step.action.availability = availability;
  return { ...availability, provider: descriptor.provider, capability: capabilityName };
}

async function executePlan(ports, objective, plan) {
  objective.status = ObjectiveStatus.RUNNING;
  objective.updatedAt = new Date().toISOString();
  await ports.objectives.save(objective);

  for (const step of plan.steps) {
    if (step.status === 'COMPLETED') continue;

    const availability = await refreshConnectionAvailability(ports, step);
    if (!availability.available) {
      step.status = 'BLOCKED_CONNECTION';
      await ports.plans.save(plan);
      objective.status = ObjectiveStatus.WAITING_CONNECTION;
      objective.updatedAt = new Date().toISOString();
      await ports.objectives.save(objective);
      await ports.evidence.append({
        type: 'CONNECTION_REQUIRED',
        objectiveId: objective.id,
        stepId: step.id,
        provider: availability.provider ?? null,
        capability: availability.capability ?? step.action?.capability ?? null,
        reason: availability.reason,
        missingScopes: availability.missingScopes ?? [],
        at: objective.updatedAt,
      });
      return { objective, plan, connection: availability };
    }
    if (step.status === 'BLOCKED_CONNECTION') step.status = 'PENDING';

    const authorization = await ports.policy.authorize({ objective, plan, step });
    if (!authorization.allowed) {
      step.status = 'AWAITING_APPROVAL';
      await ports.plans.save(plan);
      objective.status = ObjectiveStatus.WAITING_APPROVAL;
      objective.updatedAt = new Date().toISOString();
      await ports.objectives.save(objective);
      await ports.evidence.append({
        type: 'APPROVAL_REQUIRED',
        objectiveId: objective.id,
        stepId: step.id,
        capability: authorization.capability ?? step.action?.capability ?? step.action?.tool ?? null,
        tool: authorization.tool ?? step.action?.tool ?? null,
        scopes: authorization.scopes ?? step.action?.scopes ?? [],
        risk: authorization.risk ?? step.action?.risk ?? null,
        reason: authorization.reason,
        at: objective.updatedAt,
      });
      return { objective, plan, authorization };
    }

    step.status = 'RUNNING';
    await ports.plans.save(plan);
    await ports.evidence.append({
      type: 'STEP_STARTED',
      objectiveId: objective.id,
      stepId: step.id,
      kind: step.kind,
      capability: step.action?.capability ?? step.action?.tool ?? null,
      tool: step.action?.tool ?? null,
      at: new Date().toISOString(),
    });

    const result = await ports.execution.run({ objective, plan, step });
    step.status = result?.ok ? 'COMPLETED' : 'FAILED';
    await ports.plans.save(plan);
    await ports.evidence.append({
      type: 'STEP_EXECUTED',
      objectiveId: objective.id,
      stepId: step.id,
      kind: step.kind,
      capability: step.action?.capability ?? step.action?.tool ?? null,
      tool: step.action?.tool ?? null,
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
      const plan = await ports.planner.plan(objective, { capabilities: ports.tools, connections: ports.connections });
      await ports.objectives.save(objective);
      await ports.plans.save(plan);
      await ports.evidence.append({ type: 'OBJECTIVE_CREATED', objectiveId: objective.id, intent: plan.intent ?? objective.title, at: objective.createdAt });
      await ports.evidence.append({
        type: 'PLAN_CREATED', objectiveId: objective.id,
        steps: plan.steps.map((step) => ({ id: step.id, kind: step.kind, capability: step.action?.capability ?? step.action?.tool ?? null, scopes: step.action?.scopes ?? [], status: step.status })),
        at: new Date().toISOString(),
      });
      return executePlan(ports, objective, plan);
    },

    async approve(objectiveId, capability) {
      const objective = await ports.objectives.get(objectiveId);
      if (!objective) throw new Error(`objective not found: ${objectiveId}`);
      const plan = await ports.plans.get(objectiveId);
      if (!plan) throw new Error(`plan not found for objective: ${objectiveId}`);
      const action = plan.steps.find((step) => (step.action?.capability ?? step.action?.tool) === capability)?.action;
      if (!action) throw new Error(`capability is not part of objective plan: ${capability}`);
      approveCapability(objective, capability, action.scopes ?? []);
      await ports.objectives.save(objective);
      await ports.evidence.append({ type: 'TOOL_APPROVED', objectiveId, capability, tool: capability, scopes: action.scopes ?? [], risk: action.risk, at: objective.updatedAt });
      return executePlan(ports, objective, plan);
    },

    async resume(objectiveId) {
      const objective = await ports.objectives.get(objectiveId);
      if (!objective) throw new Error(`objective not found: ${objectiveId}`);
      if (objective.status === ObjectiveStatus.COMPLETED) return { objective, plan: await ports.plans.get(objectiveId) };
      const plan = await ports.plans.get(objectiveId);
      if (!plan) throw new Error(`plan not found for objective: ${objectiveId}`);
      await ports.evidence.append({ type: 'OBJECTIVE_RESUMED', objectiveId, at: new Date().toISOString() });
      return executePlan(ports, objective, plan);
    },

    async setConnection(record) {
      const saved = await ports.connections.save(record);
      await ports.evidence.append({ type: 'CONNECTION_STATE_CHANGED', provider: saved.provider, status: saved.status, grantedScopes: saved.grantedScopes, missingScopes: saved.missingScopes, at: saved.checkedAt });
      return saved;
    },

    async connections() { return ports.connections.list(); },

    async get(objectiveId) {
      return { objective: await ports.objectives.get(objectiveId), plan: await ports.plans.get(objectiveId), evidence: typeof ports.evidence.list === 'function' ? await ports.evidence.list({ objectiveId }) : [] };
    },

    async history() {
      if (typeof ports.objectives.list !== 'function') return [];
      const objectives = await ports.objectives.list();
      return objectives.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((objective) => ({ id: objective.id, title: objective.title, status: objective.status, updatedAt: objective.updatedAt, approvals: objective.approvals ?? [] }));
    },

    tools() { return typeof ports.tools?.list === 'function' ? ports.tools.list() : []; },
  };
}
