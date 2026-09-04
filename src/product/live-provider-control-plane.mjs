function jsonHeaders(token) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function readResponse(response, label) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { raw: text }; }
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error?.message ?? body?.error ?? `${response.status}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return body ?? {};
}

function requireValue(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function createGitHubWebhookControlClient({
  fetchImpl = globalThis.fetch,
  token,
  webhookSecret,
  apiBase = 'https://api.github.com',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const authToken = requireValue(token, 'github token');
  const secret = requireValue(webhookSecret, 'github webhook secret');

  async function create({ automationId, callbackUrl, metadata = {} }) {
    const repository = requireValue(metadata.repository, 'github repository');
    const events = Array.isArray(metadata.events) && metadata.events.length ? metadata.events.map(String) : ['issues'];
    const response = await fetchImpl(`${apiBase}/repos/${repository}/hooks`, {
      method: 'POST', headers: jsonHeaders(authToken),
      body: JSON.stringify({
        name: 'web', active: true, events,
        config: { url: requireValue(callbackUrl, 'callbackUrl'), content_type: 'json', secret, insecure_ssl: '0' },
      }),
    });
    const body = await readResponse(response, 'github webhook create');
    return { externalId: String(body.id), metadata: { repository, events, automationId } };
  }

  async function renew(subscription) {
    const repository = requireValue(subscription.metadata?.repository, 'github repository');
    const externalId = requireValue(subscription.externalId, 'github webhook id');
    const events = Array.isArray(subscription.metadata?.events) && subscription.metadata.events.length ? subscription.metadata.events : ['issues'];
    const response = await fetchImpl(`${apiBase}/repos/${repository}/hooks/${externalId}`, {
      method: 'PATCH', headers: jsonHeaders(authToken),
      body: JSON.stringify({ active: true, events, config: { url: subscription.callbackUrl, content_type: 'json', secret, insecure_ssl: '0' } }),
    });
    await readResponse(response, 'github webhook renew');
    return { externalId, metadata: { repository, events } };
  }

  async function stop(subscription) {
    const repository = requireValue(subscription.metadata?.repository, 'github repository');
    const externalId = requireValue(subscription.externalId, 'github webhook id');
    const response = await fetchImpl(`${apiBase}/repos/${repository}/hooks/${externalId}`, { method: 'DELETE', headers: jsonHeaders(authToken) });
    if (response.status !== 204) await readResponse(response, 'github webhook stop');
    return true;
  }

  return { create, renew, stop };
}

export function createGmailWatchControlClient({
  fetchImpl = globalThis.fetch,
  accessToken,
  apiBase = 'https://gmail.googleapis.com/gmail/v1',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const token = requireValue(accessToken, 'gmail access token');

  async function watch({ metadata = {} }) {
    const userId = String(metadata.userId ?? 'me');
    const topicName = requireValue(metadata.topicName, 'gmail topicName');
    const body = { topicName };
    if (Array.isArray(metadata.labelIds) && metadata.labelIds.length) body.labelIds = metadata.labelIds.map(String);
    if (metadata.labelFilterBehavior) body.labelFilterBehavior = String(metadata.labelFilterBehavior);
    const response = await fetchImpl(`${apiBase}/users/${encodeURIComponent(userId)}/watch`, {
      method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(body),
    });
    const payload = await readResponse(response, 'gmail watch');
    const expiresAt = payload.expiration ? new Date(Number(payload.expiration)).toISOString() : null;
    return { externalId: payload.historyId ? String(payload.historyId) : null, expiresAt, metadata: { userId, topicName, labelIds: body.labelIds ?? [] } };
  }

  async function stop(subscription) {
    const userId = String(subscription.metadata?.userId ?? 'me');
    const response = await fetchImpl(`${apiBase}/users/${encodeURIComponent(userId)}/stop`, { method: 'POST', headers: jsonHeaders(token), body: '{}' });
    await readResponse(response, 'gmail watch stop');
    return true;
  }

  return {
    create: watch,
    async renew(subscription) { return watch({ metadata: subscription.metadata ?? {} }); },
    stop,
  };
}

export function createGoogleCalendarChannelControlClient({
  fetchImpl = globalThis.fetch,
  accessToken,
  channelToken = '',
  apiBase = 'https://www.googleapis.com/calendar/v3',
  channelIdFactory = ({ automationId }) => `naia-${automationId}-${Date.now()}`,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const token = requireValue(accessToken, 'calendar access token');

  async function create({ automationId, callbackUrl, metadata = {} }) {
    const calendarId = String(metadata.calendarId ?? 'primary');
    const channelId = requireValue(channelIdFactory({ automationId, metadata }), 'calendar channel id');
    const requestBody = { id: channelId, type: 'web_hook', address: requireValue(callbackUrl, 'callbackUrl') };
    if (channelToken) requestBody.token = channelToken;
    if (metadata.ttlSeconds != null) requestBody.params = { ttl: String(metadata.ttlSeconds) };
    const response = await fetchImpl(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(requestBody),
    });
    const payload = await readResponse(response, 'calendar channel create');
    const expiresAt = payload.expiration ? new Date(Number(payload.expiration)).toISOString() : null;
    return {
      externalId: String(payload.id ?? channelId), expiresAt,
      metadata: { calendarId, resourceId: payload.resourceId ? String(payload.resourceId) : null, resourceUri: payload.resourceUri ?? null },
    };
  }

  async function stop(subscription) {
    const id = requireValue(subscription.externalId, 'calendar channel id');
    const resourceId = requireValue(subscription.metadata?.resourceId, 'calendar resource id');
    const response = await fetchImpl(`${apiBase}/channels/stop`, {
      method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ id, resourceId }),
    });
    if (response.status !== 204) await readResponse(response, 'calendar channel stop');
    return true;
  }

  return {
    create,
    async renew(subscription) {
      await stop(subscription);
      return create({ automationId: subscription.automationId, callbackUrl: subscription.callbackUrl, metadata: subscription.metadata ?? {} });
    },
    stop,
  };
}
