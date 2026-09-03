export const ConnectorSource = Object.freeze({
  GATEWAY: 'connector-gateway',
});

function normalizeBaseUrl(value) {
  const url = String(value ?? '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('connector gateway URL is required');
  return url;
}

function normalizeManifest(raw) {
  if (!Array.isArray(raw)) throw new Error('connector gateway manifest must be an array');
  return raw.map((item) => {
    if (!item?.name || !item?.risk) throw new Error('connector capability requires name and risk');
    return {
      name: String(item.name),
      risk: String(item.risk),
      scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : [],
      description: String(item.description ?? ''),
      source: ConnectorSource.GATEWAY,
    };
  });
}

export function createConnectorGateway({ baseUrl, token = '', fetchImpl = globalThis.fetch } = {}) {
  const url = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  async function request(path, init = {}) {
    const response = await fetchImpl(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`connector gateway ${response.status}: ${body || response.statusText}`);
    }
    return response.json();
  }

  return {
    async manifest() {
      const body = await request('/capabilities', { method: 'GET' });
      return normalizeManifest(Array.isArray(body) ? body : body.capabilities);
    },
    async invoke(name, input, context = {}) {
      return request('/invoke', {
        method: 'POST',
        body: JSON.stringify({
          capability: name,
          input: input ?? {},
          context: {
            objectiveId: context.objective?.id ?? null,
            stepId: context.step?.id ?? null,
          },
        }),
      });
    },
  };
}

export async function createGatewayCapabilities(options = {}) {
  const gateway = createConnectorGateway(options);
  const manifest = await gateway.manifest();
  return manifest.map((item) => ({
    ...item,
    async invoke(input, context) {
      return gateway.invoke(item.name, input, context);
    },
  }));
}

export async function capabilitiesFromEnvironment(env = process.env, options = {}) {
  const baseUrl = String(env.NAIA_CONNECTOR_GATEWAY_URL ?? '').trim();
  if (!baseUrl) return [];
  return createGatewayCapabilities({
    baseUrl,
    token: env.NAIA_CONNECTOR_GATEWAY_TOKEN ?? '',
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}
