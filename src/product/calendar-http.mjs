function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('calendar baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported calendar baseUrl scheme: ${url.protocol}`);
  if (url.username || url.password) throw new Error('calendar baseUrl must not contain credentials');
  url.hash = '';
  url.search = '';
  return url;
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error(`calendar response exceeds maxBytes (${maxBytes})`);
    error.retryable = false;
    throw error;
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const error = new Error(`calendar response exceeds maxBytes (${maxBytes})`);
    error.retryable = false;
    throw error;
  }
  return text;
}

function responseError(status) {
  const error = new Error(`calendar provider HTTP ${status}`);
  error.retryable = status >= 500;
  return error;
}

function encodeEventId(eventId) {
  const value = String(eventId ?? '').trim();
  if (!value) {
    const error = new Error('calendar eventId is required');
    error.retryable = false;
    throw error;
  }
  return encodeURIComponent(value);
}

export function createCalendarHttpProvider({
  baseUrl,
  token = '',
  timeoutMs = 5000,
  maxBytes = 256 * 1024,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configuredBase = normalizeBaseUrl(baseUrl);
  const bearer = String(token ?? '').trim();
  if (typeof fetchImpl !== 'function') throw new Error('calendar HTTP provider requires fetch implementation');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('calendar timeoutMs must be a positive integer');
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('calendar maxBytes must be a positive integer');

  async function request(method, path, body = undefined) {
    const target = new URL(path, configuredBase);
    if (target.origin !== configuredBase.origin) {
      const error = new Error('calendar target escaped configured origin');
      error.retryable = false;
      throw error;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { accept: 'application/json' };
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetchImpl(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const error = new Error('calendar provider redirects are not allowed');
        error.retryable = false;
        throw error;
      }
      if (response.status >= 400) throw responseError(response.status);

      const text = await readBoundedBody(response, maxBytes);
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        const error = new Error('calendar provider returned invalid JSON');
        error.retryable = false;
        throw error;
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('calendar provider timed out');
        timeout.retryable = true;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async list({ from, to }) {
      const query = new URLSearchParams({ from, to });
      const result = await request('GET', `/events?${query}`);
      return Array.isArray(result) ? result : (result?.events ?? []);
    },
    async create({ start, end, title }) {
      return request('POST', '/events', { start, end, title });
    },
    async update({ eventId, start, end, title }) {
      return request('PATCH', `/events/${encodeEventId(eventId)}`, { start, end, title });
    },
  };
}
