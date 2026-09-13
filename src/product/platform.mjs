const SUPPORTED_PLATFORMS = new Set(['android', 'ios', 'web', 'windows', 'macos', 'linux']);
const AVAILABILITY = new Set(['AVAILABLE', 'UNAVAILABLE', 'PERMISSION_REQUIRED', 'UNSUPPORTED']);
const RISKS = new Set(['READ_ONLY', 'LOCAL_WRITE', 'EXTERNAL_WRITE', 'SENSITIVE']);

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

function assertCapability(capability) {
  if (!capability || typeof capability !== 'object' || !capability.name) {
    throw new Error('platform capability descriptor is required');
  }
  if (!Array.isArray(capability.operations) || capability.operations.length === 0) {
    throw new Error(`capability operations are required: ${capability.name}`);
  }
  if (!RISKS.has(capability.risk)) throw new Error(`unsupported capability risk: ${capability.risk}`);
  if (!AVAILABILITY.has(capability.availability)) throw new Error(`unsupported capability availability: ${capability.availability}`);
  return Object.freeze({
    name: String(capability.name),
    platform: String(capability.platform),
    operations: [...new Set(capability.operations.map(String))],
    risk: capability.risk,
    permissions: [...new Set((capability.permissions ?? []).map(String))],
    availability: capability.availability,
    ...(capability.provider ? { provider: String(capability.provider) } : {}),
  });
}

export function createPlatformCapability(capability) {
  return assertCapability(capability);
}

export function createReferencePlatformAdapter({ platform, capabilities = [], handlers = {} } = {}) {
  const name = platformName(platform);
  const catalog = new Map(capabilities.map((capability) => {
    const descriptor = assertCapability({ ...capability, platform: name });
    return [descriptor.name, descriptor];
  }));
  return {
    capabilities() { return [...catalog.keys()]; },
    describe(capability) { return catalog.get(capability) ?? null; },
    async invoke(capability, input = {}) {
      const descriptor = catalog.get(capability);
      if (!descriptor) throw new Error(`capability not supported on ${name}: ${capability}`);
      if (descriptor.availability !== 'AVAILABLE') {
        throw new Error(`capability ${capability} unavailable: ${descriptor.availability}`);
      }
      const operation = input.operation ?? 'default';
      if (!descriptor.operations.includes(operation) && !(operation === 'default' && descriptor.operations.length === 1)) {
        throw new Error(`operation not supported by ${capability}: ${operation}`);
      }
      const handler = handlers[capability]?.[operation] ?? handlers[capability]?.default;
      if (typeof handler !== 'function') throw new Error(`no reference handler for ${capability}:${operation}`);
      return handler(input);
    },
  };
}

export function createReferenceAdapters() {
  const common = (platform) => [
    { name: 'files.list', operations: ['list'], risk: 'READ_ONLY', permissions: [], availability: 'AVAILABLE', platform },
    { name: 'notifications.show', operations: ['show'], risk: 'LOCAL_WRITE', permissions: ['notifications'], availability: 'PERMISSION_REQUIRED', platform },
    { name: 'media.read', operations: ['read'], risk: 'READ_ONLY', permissions: ['media'], availability: 'UNSUPPORTED', platform },
  ];
  const handlers = {
    'files.list': { list: ({ entries = [] }) => ({ entries: [...entries] }) },
  };
  return {
    web: createReferencePlatformAdapter({ platform: 'web', capabilities: common('web'), handlers }),
    windows: createReferencePlatformAdapter({ platform: 'windows', capabilities: common('windows'), handlers }),
  };
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
    describe(platform, capability) {
      const name = platformName(platform);
      const adapter = adapters.get(name);
      return typeof adapter?.describe === 'function' ? adapter.describe(capability) : null;
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
