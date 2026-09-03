import { randomUUID } from 'node:crypto';

export const ObjectiveStatus = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
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
