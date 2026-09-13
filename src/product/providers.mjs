function providerName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!name) throw new Error('provider name is required');
  return name;
}

function assertProvider(provider) {
  if (!provider || typeof provider.complete !== 'function' || typeof provider.capabilities !== 'function') {
    throw new Error('provider must provide complete and capabilities functions');
  }
  return provider;
}

export function createProviderRegistry() {
  const providers = new Map();
  return {
    register(name, provider, { replace = false } = {}) {
      const key = providerName(name);
      if (!replace && providers.has(key)) throw new Error(`provider already registered: ${key}`);
      providers.set(key, assertProvider(provider));
      return { name: key, capabilities: [...provider.capabilities()] };
    },
    list() { return [...providers.keys()]; },
    capabilities(name) {
      const provider = providers.get(providerName(name));
      return provider ? [...provider.capabilities()] : [];
    },
    async complete(name, request) {
      const key = providerName(name);
      const provider = providers.get(key);
      if (!provider) throw new Error(`provider not registered: ${key}`);
      return provider.complete(request);
    },
  };
}

export function createProviderRouter({ registry, order = [] } = {}) {
  if (!registry || typeof registry.complete !== 'function' || typeof registry.capabilities !== 'function') {
    throw new Error('provider router requires a provider registry');
  }
  return {
    async complete(request, { capability = 'chat.completions', providers = order } = {}) {
      const candidates = [...providers];
      if (!candidates.length) throw new Error('no providers configured');
      const failures = [];
      for (const provider of candidates) {
        if (!registry.capabilities(provider).includes(capability)) continue;
        try {
          return { provider, response: await registry.complete(provider, request) };
        } catch (error) {
          failures.push({ provider, error: error?.message ?? String(error) });
        }
      }
      const detail = failures.map(({ provider, error }) => `${provider}: ${error}`).join('; ');
      throw new Error(detail ? `all compatible providers failed: ${detail}` : `no provider supports capability: ${capability}`);
    },
  };
}
