import { createDefaultCapabilityRegistry } from './capabilities.mjs';

function normalize(text) {
  return String(text ?? '').trim();
}

export function planIntent(objective, { capabilities = createDefaultCapabilityRegistry() } = {}) {
  const intent = normalize(objective.title);
  const resolved = capabilities.resolve(intent);
  if (!resolved) {
    const error = new Error(`unsupported intent: ${intent}`);
    error.code = 'UNSUPPORTED_INTENT';
    throw error;
  }

  return {
    objectiveId: objective.id,
    intent,
    capabilityId: resolved.capabilityId,
    steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action: resolved.action },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
    ],
  };
}

export function createCapabilityPlanner({ capabilities = createDefaultCapabilityRegistry() } = {}) {
  return {
    async plan(objective) {
      return planIntent(objective, { capabilities });
    },
    capabilities,
  };
}
