export const CapabilityRisk = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  LOCAL_WRITE: 'LOCAL_WRITE',
  EXTERNAL_WRITE: 'EXTERNAL_WRITE',
});

function assertCapability(capability) {
  if (!capability?.name) throw new Error('capability name is required');
  if (!Object.values(CapabilityRisk).includes(capability.risk)) {
    throw new Error(`unsupported capability risk: ${capability?.risk}`);
  }
  if (typeof capability.invoke !== 'function') throw new Error(`capability ${capability.name} requires invoke()`);
  return capability;
}

function cloneSchema(value) {
  return value == null ? null : structuredClone(value);
}

export function createCapabilityRegistry(initial = []) {
  const entries = new Map();

  function register(capability) {
    const value = assertCapability(capability);
    if (entries.has(value.name)) throw new Error(`capability already registered: ${value.name}`);
    entries.set(value.name, value);
    return value;
  }

  for (const capability of initial) register(capability);

  return {
    register,
    has(name) { return entries.has(name); },
    describe(name) {
      const item = entries.get(name);
      return item ? {
        name: item.name,
        risk: item.risk,
        scopes: [...(item.scopes ?? [])],
        description: item.description ?? '',
        source: item.source ?? 'local',
        provider: item.provider ?? null,
        pack: item.pack ?? null,
        packVersion: item.packVersion ?? null,
        inputSchema: cloneSchema(item.inputSchema),
        outputSchema: cloneSchema(item.outputSchema),
      } : null;
    },
    list() { return [...entries.keys()].map((name) => this.describe(name)); },
    async invoke(name, input, context = {}) {
      const item = entries.get(name);
      if (!item) throw new Error(`capability not found: ${name}`);
      return item.invoke(input ?? {}, context);
    },
  };
}

export function actionFromCapability(registry, name, input = {}) {
  const capability = registry.describe(name);
  if (!capability) throw new Error(`capability not found: ${name}`);
  return {
    capability: name,
    tool: name,
    input,
    risk: capability.risk,
    scopes: capability.scopes,
    requiresApproval: capability.risk !== CapabilityRisk.READ_ONLY,
  };
}
