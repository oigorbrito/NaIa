import { randomUUID } from 'node:crypto';

export const ObjectiveStatus = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  WAITING_CONNECTION: 'WAITING_CONNECTION',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export function createObjective({ title, description = '', id = randomUUID(), createdAt = new Date().toISOString() }) {
  if (!title || !title.trim()) throw new Error('objective title is required');
  return {
    id,
    title: title.trim(),
    description: description.trim(),
    approvals: [],
    status: ObjectiveStatus.PLANNED,
    createdAt,
    updatedAt: createdAt,
  };
}

export function approveCapability(objective, capability, scopes = []) {
  if (!capability || !capability.trim()) throw new Error('capability approval is required');
  const normalizedScopes = [...new Set((scopes ?? []).map((scope) => String(scope).trim()).filter(Boolean))].sort();
  const existing = Array.isArray(objective.approvals) ? objective.approvals : [];
  const retained = existing.filter((approval) => {
    const name = typeof approval === 'string' ? approval : approval?.capability;
    return name !== capability.trim();
  });
  retained.push({ capability: capability.trim(), scopes: normalizedScopes });
  objective.approvals = retained;
  objective.updatedAt = new Date().toISOString();
  return objective;
}

export function approveTool(objective, tool) {
  return approveCapability(objective, tool, []);
}

export function hasCapabilityApproval(objective, capability, scopes = []) {
  const requiredScopes = new Set((scopes ?? []).map(String));
  const approvals = Array.isArray(objective.approvals) ? objective.approvals : [];
  return approvals.some((approval) => {
    if (typeof approval === 'string') return approval === capability && requiredScopes.size === 0;
    if (approval?.capability !== capability) return false;
    const granted = new Set(Array.isArray(approval.scopes) ? approval.scopes : []);
    return [...requiredScopes].every((scope) => granted.has(scope));
  });
}
