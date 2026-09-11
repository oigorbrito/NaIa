import { randomUUID } from 'node:crypto';

export const ObjectiveStatus = Object.freeze({
  PLANNED: 'PLANNED',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  RUNNING: 'RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export function approvalToken(tool, scope = null) {
  const normalizedTool = String(tool ?? '').trim();
  if (!normalizedTool) throw new Error('tool approval is required');
  const normalizedScope = scope == null ? '' : String(scope).trim();
  return normalizedScope ? `${normalizedTool}::${normalizedScope}` : normalizedTool;
}

export function createObjective({ title, description = '', id = randomUUID(), idempotencyKey = null, createdAt = new Date().toISOString() }) {
  if (!title || !title.trim()) throw new Error('objective title is required');
  return {
    id,
    title: title.trim(),
    description: description.trim(),
    idempotencyKey: idempotencyKey?.trim() || null,
    approvals: [],
    attempts: 0,
    lastError: null,
    retryDisposition: null,
    status: ObjectiveStatus.PLANNED,
    createdAt,
    updatedAt: createdAt,
  };
}

export function approveTool(objective, tool, scope = null) {
  const approvals = new Set(Array.isArray(objective.approvals) ? objective.approvals : []);
  approvals.add(approvalToken(tool, scope));
  objective.approvals = [...approvals];
  objective.updatedAt = new Date().toISOString();
  return objective;
}
