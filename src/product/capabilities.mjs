function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseNote(input) {
  const match = input.match(/^note\s+([^:]+):\s*(.+)$/i);
  if (!match) return null;
  return { name: match[1].trim(), content: match[2].trim() };
}

function assertCapability(capability) {
  if (!capability || typeof capability !== 'object') throw new Error('capability must be an object');
  if (!normalizeText(capability.id)) throw new Error('capability id is required');
  if (typeof capability.match !== 'function') throw new Error(`capability ${capability.id} match must be a function`);
  if (typeof capability.buildAction !== 'function') throw new Error(`capability ${capability.id} buildAction must be a function`);
  return capability;
}

export function createCapabilityRegistry(initial = []) {
  const capabilities = new Map();

  function register(capability) {
    assertCapability(capability);
    const id = normalizeText(capability.id);
    if (capabilities.has(id)) throw new Error(`capability already registered: ${id}`);
    capabilities.set(id, { ...capability, id });
    return id;
  }

  for (const capability of initial) register(capability);

  return {
    register,
    list() {
      return [...capabilities.values()].map(({ match, buildAction, ...meta }) => ({ ...meta }));
    },
    resolve(intent) {
      const normalized = normalizeText(intent);
      const matches = [];
      for (const capability of capabilities.values()) {
        const match = capability.match(normalized);
        if (match !== null && match !== undefined && match !== false) {
          matches.push({ capability, match });
        }
      }
      if (matches.length > 1) {
        const ids = matches.map(({ capability }) => capability.id).join(', ');
        const error = new Error(`ambiguous intent matched multiple capabilities: ${ids}`);
        error.code = 'AMBIGUOUS_INTENT';
        throw error;
      }
      if (matches.length === 0) return null;
      const [{ capability, match }] = matches;
      const action = capability.buildAction({ intent: normalized, match });
      if (!action?.tool) throw new Error(`capability ${capability.id} produced an action without tool`);
      return { capabilityId: capability.id, action };
    },
  };
}

export function createDefaultCapabilityRegistry() {
  return createCapabilityRegistry([
    {
      id: 'time.current',
      description: 'Read the current time',
      match(intent) {
        const lower = intent.toLowerCase();
        return lower === 'time' || lower === 'what time' || lower === 'current time' ? {} : null;
      },
      buildAction() {
        return { tool: 'time.now', input: {}, risk: 'READ_ONLY', requiresApproval: false };
      },
    },
    {
      id: 'text.uppercase',
      description: 'Uppercase supplied text',
      match(intent) {
        if (!/^uppercase\s*:?\s*/i.test(intent)) return null;
        return { text: intent.replace(/^uppercase\s*:?\s*/i, '') };
      },
      buildAction({ match }) {
        return { tool: 'text.uppercase', input: { text: match.text }, risk: 'READ_ONLY', requiresApproval: false };
      },
    },
    {
      id: 'note.write',
      description: 'Write a local note',
      match(intent) {
        return parseNote(intent);
      },
      buildAction({ match }) {
        return { tool: 'note.write', input: match, risk: 'LOCAL_WRITE', requiresApproval: true };
      },
    },
  ]);
}
