export function assertProductPorts(ports) {
  const required = ['objectives', 'plans', 'evidence', 'execution'];
  for (const name of required) {
    if (!ports?.[name]) throw new Error(`missing product port: ${name}`);
  }
  for (const [name, methods] of Object.entries({ objectives: ['save', 'get'], plans: ['save', 'get'] })) {
    for (const method of methods) {
      if (typeof ports[name][method] !== 'function') throw new Error(`${name}.${method} must be a function`);
    }
  }
  if (typeof ports.evidence.append !== 'function') throw new Error('evidence.append must be a function');
  if (typeof ports.execution.run !== 'function') throw new Error('execution.run must be a function');
  return ports;
}

export function createInMemoryPorts() {
  const objectives = new Map();
  const plans = new Map();
  const evidence = [];
  return {
    objectives: {
      async save(objective) { objectives.set(objective.id, structuredClone(objective)); return objective; },
      async get(id) { const value = objectives.get(id); return value ? structuredClone(value) : null; },
      async list() { return [...objectives.values()].map((value) => structuredClone(value)); },
    },
    plans: {
      async save(plan) { plans.set(plan.objectiveId, structuredClone(plan)); return plan; },
      async get(objectiveId) { const value = plans.get(objectiveId); return value ? structuredClone(value) : null; },
    },
    evidence: {
      async append(record) { evidence.push(structuredClone(record)); return record; },
      async list({ objectiveId } = {}) {
        const rows = structuredClone(evidence);
        return objectiveId ? rows.filter((row) => row.objectiveId === objectiveId) : rows;
      },
    },
    execution: {
      async run({ step }) { return { ok: true, output: { stepId: step.id, kind: step.kind } }; },
    },
  };
}
