function normalizeToolName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('HTTP read tool name is required');
  return name;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('HTTP read baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`unsupported HTTP read baseUrl scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('HTTP read baseUrl must not contain credentials');
  }
  url.hash = '';
  url.search = '';
  return url;
}

function resolvePath(baseUrl, value) {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) {
    const error = new Error('HTTP read path must begin with a single /');
    error.retryable = false;
    throw error;
  }
  const target = new URL(path, baseUrl);
  if (target.origin !== baseUrl.origin) {
    const error = new Error('HTTP read target escaped configured origin');
    error.retryable = false;
    throw error;
  }
  return target;
}

async function readBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error(`HTTP response exceeds maxBytes (${maxBytes})`);
    error.retryable = false;
    throw error;
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('body limit exceeded');
        const error = new Error(`HTTP response exceeds maxBytes (${maxBytes})`);
        error.retryable = false;
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function normalizeFailure(error) {
  if (error?.name === 'AbortError') {
    return { ok: false, error: 'HTTP read timed out', retryable: true };
  }
  return {
    ok: false,
    error: error?.message ?? String(error),
    retryable: error?.retryable !== false,
  };
}

export function createHttpReadCapability({ id = 'http.read', prefix = 'fetch', tool = 'http.read' } = {}) {
  const capabilityId = String(id ?? '').trim();
  const normalizedPrefix = String(prefix ?? '').trim();
  const toolName = normalizeToolName(tool);
  if (!capabilityId) throw new Error('HTTP read capability id is required');
  if (!normalizedPrefix) throw new Error('HTTP read capability prefix is required');

  return {
    id: capabilityId,
    description: 'Read a configured external HTTP provider path',
    match(intent) {
      const expression = new RegExp(`^${normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.+)$`, 'i');
      const match = String(intent ?? '').match(expression);
      if (!match) return null;
      return { path: match[1].trim() };
    },
    buildAction({ match }) {
      return {
        tool: toolName,
        input: { path: match.path },
        risk: 'READ_ONLY',
        requiresApproval: false,
      };
    },
  };
}

export function createHttpReadAdapter({
  baseUrl,
  tool = 'http.read',
  timeoutMs = 5000,
  maxBytes = 256 * 1024,
  maxRedirects = 3,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configuredBase = normalizeBaseUrl(baseUrl);
  const toolName = normalizeToolName(tool);
  if (typeof fetchImpl !== 'function') throw new Error('HTTP read adapter requires fetch implementation');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('HTTP read timeoutMs must be a positive integer');
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('HTTP read maxBytes must be a positive integer');
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new Error('HTTP read maxRedirects must be a non-negative integer');

  return {
    supports(name) {
      return name === toolName;
    },

    async run(request) {
      const path = request?.step?.action?.input?.path;
      let target;
      try {
        target = resolvePath(configuredBase, path);
      } catch (error) {
        return normalizeFailure(error);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        let redirects = 0;
        let current = target;

        while (true) {
          response = await fetchImpl(current, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
          });

          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          if (redirects >= maxRedirects) {
            await response.body?.cancel();
            const error = new Error(`HTTP redirect limit exceeded (${maxRedirects})`);
            error.retryable = false;
            throw error;
          }
          const location = response.headers.get('location');
          if (!location) {
            await response.body?.cancel();
            const error = new Error('HTTP redirect missing location');
            error.retryable = false;
            throw error;
          }
          const next = new URL(location, current);
          if (next.origin !== configuredBase.origin) {
            await response.body?.cancel();
            const error = new Error('HTTP redirect escaped configured origin');
            error.retryable = false;
            throw error;
          }
          await response.body?.cancel();
          current = next;
          redirects += 1;
        }

        const body = await readBody(response, maxBytes);
        if (response.status >= 500) {
          return { ok: false, error: `HTTP ${response.status}`, retryable: true };
        }
        if (response.status >= 400) {
          return { ok: false, error: `HTTP ${response.status}`, retryable: false };
        }

        return {
          ok: true,
          output: {
            tool: toolName,
            result: {
              status: response.status,
              contentType: response.headers.get('content-type'),
              body,
              path: `${current.pathname}${current.search}`,
              redirects,
            },
          },
        };
      } catch (error) {
        return normalizeFailure(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
