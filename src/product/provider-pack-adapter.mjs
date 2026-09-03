import { findProviderCapability, providerCapabilityDescriptors, validateCapabilityInput } from './provider-packs.mjs';

export function createProviderPackCapabilities({ invoke } = {}) {
  if (typeof invoke !== 'function') throw new Error('provider pack invoke function is required');
  return providerCapabilityDescriptors().map((descriptor) => ({
    ...descriptor,
    source: 'provider-pack',
    async invoke(input, context = {}) {
      validateCapabilityInput(descriptor, input);
      return invoke(descriptor.name, input ?? {}, context, descriptor);
    },
  }));
}

export function createGatewayProviderPackCapabilities({ gateway }) {
  if (!gateway || typeof gateway.invoke !== 'function') throw new Error('connector gateway is required');
  return createProviderPackCapabilities({
    async invoke(name, input, context) {
      return gateway.invoke(name, input, context);
    },
  });
}

export function assertProviderCapabilityManifest(manifest = []) {
  const remote = new Map(manifest.map((item) => [item.name, item]));
  return providerCapabilityDescriptors().map((expected) => {
    const actual = remote.get(expected.name);
    if (!actual) return { name: expected.name, available: false, compatible: false, reason: 'not-advertised' };
    const missingScopes = expected.scopes.filter((scope) => !(actual.scopes ?? []).includes(scope));
    const compatible = actual.risk === expected.risk && missingScopes.length === 0;
    return {
      name: expected.name,
      available: true,
      compatible,
      reason: compatible ? 'compatible' : 'metadata-mismatch',
      expectedRisk: expected.risk,
      actualRisk: actual.risk,
      missingScopes,
    };
  });
}

export function providerCapabilitySchema(name) {
  const descriptor = findProviderCapability(name);
  if (!descriptor) throw new Error(`unknown provider capability: ${name}`);
  return structuredClone(descriptor.inputSchema);
}
