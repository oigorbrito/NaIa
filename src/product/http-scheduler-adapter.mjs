import { createSchedulerAdapter } from './scheduler-adapter.mjs';

function headers(token) {
  const value = { accept: 'application/json', 'content-type': 'application/json' };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

async function parse(response, label) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { raw: text }; }
  }
  if (!response.ok) throw new Error(`${label} failed: ${body?.message ?? body?.error ?? response.status}`);
  return body;
}

export function createHttpSchedulerAdapter({
  baseUrl,
  token = '',
  fetchImpl = globalThis.fetch,
  callbackUrl,
} = {}) {
  const root = String(baseUrl ?? '').replace(/\/$/, '');
  if (!root) throw new Error('scheduler baseUrl is required');
  if (!callbackUrl) throw new Error('scheduler callbackUrl is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  return createSchedulerAdapter({
    async register(input) {
      const response = await fetchImpl(`${root}/registrations/${encodeURIComponent(input.automationId)}`, {
        method: 'PUT', headers: headers(token),
        body: JSON.stringify({
          automationId: input.automationId,
          schedule: input.schedule,
          timezone: input.timezone ?? 'UTC',
          callbackUrl,
          metadata: input.metadata ?? {},
        }),
      });
      return await parse(response, 'scheduler register') ?? input;
    },
    async unregister(automationId) {
      const response = await fetchImpl(`${root}/registrations/${encodeURIComponent(automationId)}`, {
        method: 'DELETE', headers: headers(token),
      });
      if (response.status === 204 || response.status === 404) return true;
      await parse(response, 'scheduler unregister');
      return true;
    },
    async list() {
      const response = await fetchImpl(`${root}/registrations`, { method: 'GET', headers: headers(token) });
      const body = await parse(response, 'scheduler list');
      return Array.isArray(body) ? body : body?.registrations ?? [];
    },
  });
}
