const SUPPORTED_PLATFORMS = new Set(['android', 'ios', 'web', 'windows', 'macos', 'linux']);

function platformName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(name)) throw new Error(`unsupported platform: ${value}`);
  return name;
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('platform adapter is required');
  if (typeof adapter.capabilities !== 'function' || typeof adapter.invoke !== 'function') {
    throw new Error('platform adapter must provide capabilities and invoke functions');
  }
  return adapter;
}

export function createPlatformRegistry() {
  const adapters = new Map();

  return {
    register(platform, adapter, { replace = false } = {}) {
      const name = platformName(platform);
      if (!replace && adapters.has(name)) throw new Error(`platform adapter already registered: ${name}`);
      adapters.set(name, assertAdapter(adapter));
      return { platform: name, capabilities: [...adapter.capabilities()] };
    },
    has(platform) { return adapters.has(platformName(platform)); },
    list() { return [...adapters.keys()]; },
    capabilities(platform) {
      const name = platformName(platform);
      const adapter = adapters.get(name);
      if (!adapter) return [];
      return [...adapter.capabilities()];
    },
    async invoke(platform, capability, input = {}) {
      const name = platformName(platform);
      const adapter = adapters.get(name);
      if (!adapter) throw new Error(`platform adapter not registered: ${name}`);
      const available = new Set(adapter.capabilities());
      if (!available.has(capability)) throw new Error(`capability not supported on ${name}: ${capability}`);
      return adapter.invoke(capability, input);
    },
  };
}

export function createPlatformRuntime({ platform, registry } = {}) {
  if (!registry || typeof registry.invoke !== 'function') throw new Error('platform runtime requires a platform registry');
  const current = platformName(platform);
  return {
    platform: current,
    capabilities() { return registry.capabilities(current); },
    invoke(capability, input = {}) { return registry.invoke(current, capability, input); },
  };
}

export { SUPPORTED_PLATFORMS };
