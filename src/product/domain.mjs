import { randomUUID } from 'node:crypto';

export const ObjectiveStatus = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
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
    confirmations: [],
    status: ObjectiveStatus.PLANNED,
    createdAt,
    updatedAt: createdAt,
  };
}

export function approveTool(objective, tool) {
  if (!tool || !tool.trim()) throw new Error('tool approval is required');
  const approvals = new Set(Array.isArray(objective.approvals) ? objective.approvals : []);
  approvals.add(tool.trim());
  objective.approvals = [...approvals];
  objective.updatedAt = new Date().toISOString();
  return objective;
}

export function confirmChoice(objective, confirmationId) {
  if (!confirmationId || !String(confirmationId).trim()) throw new Error('confirmation id is required');
  const confirmations = new Set(Array.isArray(objective.confirmations) ? objective.confirmations : []);
  confirmations.add(String(confirmationId).trim());
  objective.confirmations = [...confirmations];
  objective.updatedAt = new Date().toISOString();
  return objective;
}
