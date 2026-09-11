function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? 'https://www.googleapis.com'));
  } catch {
    throw new Error('Google Calendar API base URL must be valid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported Google Calendar API scheme: ${url.protocol}`);
  if (url.username || url.password) throw new Error('Google Calendar API base URL must not contain credentials');
  url.hash = '';
  url.search = '';
  return url;
}

function requireToken(value) {
  const token = String(value ?? '').trim();
  if (!token) throw new Error('Google Calendar access token is required');
  return token;
}

function errorForStatus(status) {
  const error = new Error(`Google Calendar HTTP ${status}`);
  error.retryable = status === 429 || status >= 500;
  return error;
}

async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error(`Google Calendar response exceeds maxBytes (${maxBytes})`);
    error.retryable = false;
    throw error;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('Google Calendar body limit exceeded');
        const error = new Error(`Google Calendar response exceeds maxBytes (${maxBytes})`);
        error.retryable = false;
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Google Calendar returned invalid JSON');
    error.retryable = false;
    throw error;
  }
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: event.id ?? null,
    title: event.summary ?? '',
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    status: event.status ?? null,
    htmlLink: event.htmlLink ?? null,
  };
}

export function createGoogleCalendarProvider({
  accessToken,
  calendarId = 'primary',
  apiBaseUrl = 'https://www.googleapis.com',
  timeoutMs = 5000,
  maxBytes = 256 * 1024,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = requireToken(accessToken);
  const configuredBase = normalizeBaseUrl(apiBaseUrl);
  const selectedCalendar = String(calendarId ?? 'primary').trim() || 'primary';
  if (typeof fetchImpl !== 'function') throw new Error('Google Calendar provider requires fetch implementation');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Google Calendar timeoutMs must be a positive integer');
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('Google Calendar maxBytes must be a positive integer');

  const calendarPath = `/calendar/v3/calendars/${encodeURIComponent(selectedCalendar)}/events`;

  async function request(method, path, { query, body } = {}) {
    const target = new URL(path, configuredBase);
    if (target.origin !== configuredBase.origin) {
      const error = new Error('Google Calendar target escaped configured origin');
      error.retryable = false;
      throw error;
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetchImpl(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        try { await response.body?.cancel(); } catch {}
        const error = new Error('Google Calendar redirects are not allowed');
        error.retryable = false;
        throw error;
      }
      if (response.status >= 400) {
        try { await response.body?.cancel(); } catch {}
        throw errorForStatus(response.status);
      }
      return readBoundedJson(response, maxBytes);
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('Google Calendar request timed out');
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
      const payload = await request('GET', calendarPath, {
        query: {
          timeMin: from,
          timeMax: to,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        },
      });
      return (payload?.items ?? []).map(normalizeEvent).filter(Boolean);
    },
    async create({ start, end, title }) {
      const payload = await request('POST', calendarPath, {
        body: {
          summary: title,
          start: { dateTime: start },
          end: { dateTime: end },
        },
      });
      return normalizeEvent(payload);
    },
    async update({ eventId, start, end, title }) {
      const id = String(eventId ?? '').trim();
      if (!id) {
        const error = new Error('Google Calendar eventId is required');
        error.retryable = false;
        throw error;
      }
      const payload = await request('PATCH', `${calendarPath}/${encodeURIComponent(id)}`, {
        body: {
          summary: title,
          start: { dateTime: start },
          end: { dateTime: end },
        },
      });
      return normalizeEvent(payload);
    },
  };
}
