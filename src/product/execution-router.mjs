function assertAdapter(adapter, index) {
  if (!adapter || typeof adapter !== 'object') throw new Error(`execution adapter ${index} must be an object`);
  if (typeof adapter.supports !== 'function') throw new Error(`execution adapter ${index}.supports must be a function`);
  if (typeof adapter.run !== 'function') throw new Error(`execution adapter ${index}.run must be a function`);
  return adapter;
}

export function createExecutionRouter({ registry, adapters = [] } = {}) {
  if (!registry || typeof registry.has !== 'function' || typeof registry.run !== 'function') {
    throw new Error('execution router requires a tool registry');
  }
  const externalAdapters = adapters.map(assertAdapter);

  return {
    async run(request) {
      const step = request?.step;
      if (!step?.action) return { ok: true, output: { controlStep: step?.kind ?? null } };
      const tool = step.action.tool;

      if (registry.has(tool)) {
        try {
          const output = await registry.run(tool, step.action.input);
          return { ok: true, output: { tool, result: output } };
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error), retryable: error?.retryable !== false };
        }
      }

      const matches = externalAdapters.filter((adapter) => adapter.supports(tool));
      if (matches.length > 1) {
        return { ok: false, error: `multiple execution adapters support tool: ${tool}`, retryable: false };
      }
      if (matches.length === 0) {
        return { ok: false, error: `tool not found: ${tool}`, retryable: false };
      }

      try {
        const result = await matches[0].run(request);
        if (!result || typeof result.ok !== 'boolean') {
          return { ok: false, error: `execution adapter returned invalid result for tool: ${tool}`, retryable: false };
        }
        return result;
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error), retryable: error?.retryable !== false };
      }
    },
  };
}
