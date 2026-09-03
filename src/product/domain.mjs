import { randomUUID } from 'node:crypto';

export const ObjectiveStatus = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export function createObjective({ title, description = '', id = randomUUID(), createdAt = new Date().toISOString() }) {
  if (!title || !title.trim()) throw new Error('objective title is required');
  return {
    id,
    title: title.trim(),
    description: description.trim(),
    status: ObjectiveStatus.PLANNED,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createPlan(objective) {
  return {
    objectiveId: objective.id,
    steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING' },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING' },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING' },
    ],
  };
}
