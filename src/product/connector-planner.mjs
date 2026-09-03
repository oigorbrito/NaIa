function parseJsonObject(text) {
  const value = String(text ?? '').trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('input must be an object');
    return parsed;
  } catch (error) {
    throw new Error(`invalid capability input JSON: ${error.message}`);
  }
}

export function parseCapabilityIntent(intent) {
  const match = String(intent ?? '').trim().match(/^use\s+([a-zA-Z0-9._:-]+)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { capability: match[1], input: parseJsonObject(match[2] ?? '') };
}

export function createConnectorAwarePlanner({ fallbackPlanner }) {
  if (!fallbackPlanner || typeof fallbackPlanner.plan !== 'function') throw new Error('fallback planner is required');
  return {
    async plan(objective, context = {}) {
      const direct = parseCapabilityIntent(objective.title);
      if (!direct) return fallbackPlanner.plan(objective, context);
      const descriptor = context.capabilities?.describe?.(direct.capability);
      if (!descriptor) throw new Error(`capability not found: ${direct.capability}`);
      const action = {
        capability: descriptor.name,
        tool: descriptor.name,
        input: direct.input,
        risk: descriptor.risk,
        scopes: descriptor.scopes ?? [],
        requiresApproval: descriptor.risk !== 'READ_ONLY',
      };
      return {
        objectiveId: objective.id,
        intent: objective.title,
        steps: [
          { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
          { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action },
          { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
        ],
      };
    },
  };
}
