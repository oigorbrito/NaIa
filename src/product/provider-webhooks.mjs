import { createHmac, timingSafeEqual } from 'node:crypto';

function header(headers, name) {
  const target = String(name).toLowerCase();
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers ?? {});
  const found = entries.find(([key]) => String(key).toLowerCase() === target);
  return found ? String(found[1]) : '';
}

function jsonFromBase64(value) {
  if (!value) return {};
  const text = Buffer.from(String(value), 'base64').toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function createGitHubWebhookAdapter({ secret } = {}) {
  const key = String(secret ?? '');
  return {
    provider: 'github',
    authenticate(request) {
      if (!key) throw new Error('github webhook secret is not configured');
      const rawBody = typeof request?.rawBody === 'string' ? request.rawBody : JSON.stringify(request?.body ?? {});
      const expected = `sha256=${createHmac('sha256', key).update(rawBody).digest('hex')}`;
      const supplied = header(request?.headers, 'x-hub-signature-256');
      const a = Buffer.from(expected);
      const b = Buffer.from(supplied);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('github webhook authentication failed');
      return { authenticated: true, provider: 'github', method: 'x-hub-signature-256' };
    },
    normalize(request, { automationId, parameters = {} } = {}) {
      const event = header(request?.headers, 'x-github-event');
      const deliveryId = header(request?.headers, 'x-github-delivery');
      if (!event) throw new Error('github webhook event header is required');
      if (!deliveryId) throw new Error('github webhook delivery header is required');
      return {
        automationId,
        trigger: { kind: 'EVENT', event: `github.${event}`, eventId: deliveryId, provider: 'github' },
        eventId: deliveryId,
        idempotencyKey: `github:${deliveryId}`,
        source: 'github',
        parameters: { ...parameters, webhook: request?.body ?? {} },
      };
    },
  };
}

export function createGmailPushAdapter() {
  return {
    provider: 'gmail',
    normalize(request, { automationId, parameters = {} } = {}) {
      const message = request?.body?.message;
      if (!message?.messageId) throw new Error('gmail push messageId is required');
      const payload = jsonFromBase64(message.data);
      return {
        automationId,
        trigger: { kind: 'EVENT', event: 'gmail.mailbox.changed', eventId: String(message.messageId), provider: 'gmail' },
        eventId: String(message.messageId),
        idempotencyKey: `gmail:${message.messageId}`,
        source: 'gmail',
        parameters: { ...parameters, push: payload, subscription: request?.body?.subscription ?? null },
      };
    },
  };
}

export function createGoogleCalendarWebhookAdapter() {
  return {
    provider: 'google-calendar',
    normalize(request, { automationId, parameters = {} } = {}) {
      const channelId = header(request?.headers, 'x-goog-channel-id');
      const resourceId = header(request?.headers, 'x-goog-resource-id');
      const resourceState = header(request?.headers, 'x-goog-resource-state');
      const messageNumber = header(request?.headers, 'x-goog-message-number');
      if (!channelId || !resourceId || !messageNumber) throw new Error('google calendar webhook identity headers are required');
      const eventId = `${channelId}:${resourceId}:${messageNumber}`;
      return {
        automationId,
        trigger: { kind: 'EVENT', event: `google-calendar.${resourceState || 'changed'}`, eventId, provider: 'google-calendar' },
        eventId,
        idempotencyKey: `google-calendar:${eventId}`,
        source: 'google-calendar',
        parameters: { ...parameters, channelId, resourceId, resourceState, messageNumber },
      };
    },
  };
}

export function createProviderWebhookIngress({ runtime, adapter, automationId, authenticator } = {}) {
  if (!runtime?.dispatch) throw new Error('trigger runtime dispatch is required');
  if (!adapter?.normalize) throw new Error('provider webhook adapter is required');
  return {
    async handle(request, context = {}) {
      if (String(request?.method ?? 'POST').toUpperCase() !== 'POST') return { status: 405, body: { error: 'method-not-allowed' } };
      try {
        const auth = adapter.authenticate
          ? adapter.authenticate(request)
          : authenticator?.authenticate
            ? await authenticator.authenticate(request)
            : { authenticated: false, provider: adapter.provider, method: 'external-boundary' };
        if (!adapter.authenticate && authenticator && !auth?.authenticated) throw new Error('provider webhook authentication failed');
        const delivery = adapter.normalize(request, { automationId: context.automationId ?? automationId, parameters: context.parameters ?? {} });
        const result = await runtime.dispatch(delivery);
        return { status: result.deduplicated ? 200 : 202, body: { ...result, auth, provider: adapter.provider } };
      } catch (error) {
        const authFailure = /authentication|secret/.test(String(error?.message ?? '').toLowerCase());
        return { status: authFailure ? 401 : 400, body: { error: authFailure ? 'unauthorized' : 'invalid-provider-webhook', message: error?.message ?? String(error), provider: adapter.provider } };
      }
    },
  };
}
