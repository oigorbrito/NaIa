export const ConnectionStatus = Object.freeze({
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  PERMISSION_MISSING: 'PERMISSION_MISSING',
});

function normalizeProvider(provider) {
  const value = String(provider ?? '').trim();
  if (!value) throw new Error('provider is required');
  return value;
}

function normalizeScopes(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : []).map(String).filter(Boolean))].sort();
}

export function createConnectionRecord({ provider, status = ConnectionStatus.DISCONNECTED, grantedScopes = [], missingScopes = [], checkedAt = new Date().toISOString(), detail = '' }) {
  if (!Object.values(ConnectionStatus).includes(status)) throw new Error(`unsupported connection status: ${status}`);
  return {
    provider: normalizeProvider(provider),
    status,
    grantedScopes: normalizeScopes(grantedScopes),
    missingScopes: normalizeScopes(missingScopes),
    checkedAt,
    detail: String(detail ?? ''),
  };
}

export function evaluateCapabilityAvailability(capability, connection) {
  if (!capability?.provider) return { available: true, reason: 'local-capability', missingScopes: [] };
  if (!connection || connection.status === ConnectionStatus.DISCONNECTED) {
    return { available: false, reason: 'provider-disconnected', missingScopes: capability.scopes ?? [] };
  }
  const granted = new Set(connection.grantedScopes ?? []);
  const missingScopes = (capability.scopes ?? []).filter((scope) => !granted.has(scope));
  if (connection.status === ConnectionStatus.PERMISSION_MISSING || missingScopes.length) {
    return { available: false, reason: 'permission-missing', missingScopes };
  }
  return { available: true, reason: 'provider-connected', missingScopes: [] };
}

export function createConnectionStateStore(initial = []) {
  const entries = new Map(initial.map((entry) => {
    const record = createConnectionRecord(entry);
    return [record.provider, record];
  }));
  return {
    async save(record) {
      const normalized = createConnectionRecord(record);
      entries.set(normalized.provider, normalized);
      return structuredClone(normalized);
    },
    async get(provider) {
      const record = entries.get(provider);
      return record ? structuredClone(record) : null;
    },
    async list() {
      return [...entries.values()].map((record) => structuredClone(record));
    },
  };
}
