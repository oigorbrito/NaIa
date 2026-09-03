export function assertProductPorts(ports) {
  const required = ['objectives', 'evidence', 'execution'];
  for (const name of required) {
    if (!ports?.[name]) throw new Error(`missing product port: ${name}`);
  }
  for (const method of ['save', 'get']) {
    if (typeof ports.objectives[method] !== 'function') throw new Error(`objectives.${method} must be a function`);
  }
  if (typeof ports.evidence.append !== 'function') throw new Error('evidence.append must be a function');
  if (typeof ports.execution.run !== 'function') throw new Error('execution.run must be a function');
  return ports;
}

export function createInMemoryPorts() {
  const objectives = new Map();
  const evidence = [];
  return {
    objectives: {
      async save(objective) { objectives.set(objective.id, structuredClone(objective)); return objective; },
      async get(id) { const value = objectives.get(id); return value ? structuredClone(value) : null; },
    },
    evidence: {
      async append(record) { evidence.push(structuredClone(record)); return record; },
      async list() { return structuredClone(evidence); },
    },
    execution: {
      async run({ step }) { return { ok: true, output: { stepId: step.id, kind: step.kind } }; },
    },
  };
}
