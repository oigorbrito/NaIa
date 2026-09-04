import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubWebhookControlClient,
  createGmailWatchControlClient,
  createGoogleCalendarChannelControlClient,
} from '../../src/product/live-provider-control-plane.mjs';
import { createHttpSchedulerAdapter, createSchedulerCallbackIngress } from '../../src/product/http-scheduler-adapter.mjs';

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

test('github live client creates, renews and stops webhook without returning token or secret', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return response(201, { id: 77 });
    if (options.method === 'PATCH') return response(200, { id: 77 });
    return response(204);
  };
  const client = createGitHubWebhookControlClient({ fetchImpl, token: 'gh-token', webhookSecret: 'hook-secret' });
  const created = await client.create({ automationId: 'a1', callbackUrl: 'https://naia.test/webhooks/github/a1', metadata: { repository: 'tihotm/NaIa', events: ['issues'] } });
  assert.equal(created.externalId, '77');
  assert.deepEqual(created.metadata.events, ['issues']);
  assert.equal(JSON.stringify(created).includes('gh-token'), false);
  assert.equal(JSON.stringify(created).includes('hook-secret'), false);
  const post = JSON.parse(calls[0].options.body);
  assert.equal(post.config.secret, 'hook-secret');
  assert.equal(calls[0].options.headers.authorization, 'Bearer gh-token');
  await client.renew({ externalId: '77', callbackUrl: 'https://naia.test/webhooks/github/a1', metadata: { repository: 'tihotm/NaIa', events: ['issues'] } });
  await client.stop({ externalId: '77', metadata: { repository: 'tihotm/NaIa' } });
  assert.match(calls[1].url, /hooks\/77$/);
  assert.equal(calls[2].options.method, 'DELETE');
});

test('gmail live client maps watch response expiration and renews through watch', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/watch')) return response(200, { historyId: '123', expiration: '1780000000000' });
    return response(204);
  };
  const client = createGmailWatchControlClient({ fetchImpl, accessToken: 'gmail-token' });
  const created = await client.create({ metadata: { userId: 'me', topicName: 'projects/p/topics/t', labelIds: ['INBOX'] } });
  assert.equal(created.externalId, '123');
  assert.ok(created.expiresAt);
  assert.equal(JSON.stringify(created).includes('gmail-token'), false);
  await client.renew({ metadata: created.metadata });
  await client.stop({ metadata: created.metadata });
  assert.equal(calls.filter((call) => call.url.endsWith('/watch')).length, 2);
  assert.equal(calls.at(-1).url.endsWith('/stop'), true);
});

test('calendar live client creates channel and renewal stops old channel before recreating', async () => {
  const calls = [];
  let watchCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/events/watch')) {
      watchCount += 1;
      return response(200, { id: `channel-${watchCount}`, resourceId: `resource-${watchCount}`, expiration: '1780000000000' });
    }
    return response(204);
  };
  const client = createGoogleCalendarChannelControlClient({
    fetchImpl, accessToken: 'cal-token', channelToken: 'channel-secret', channelIdFactory: () => `channel-request-${watchCount + 1}`,
  });
  const created = await client.create({ automationId: 'cal-auto', callbackUrl: 'https://naia.test/webhooks/google-calendar/cal-auto', metadata: { calendarId: 'primary' } });
  assert.equal(created.externalId, 'channel-1');
  assert.equal(created.metadata.resourceId, 'resource-1');
  assert.equal(JSON.stringify(created).includes('channel-secret'), false);
  const firstWatchBody = JSON.parse(calls[0].options.body);
  assert.equal(firstWatchBody.token, 'channel-secret');
  const renewed = await client.renew({ automationId: 'cal-auto', externalId: created.externalId, callbackUrl: 'https://naia.test/webhooks/google-calendar/cal-auto', metadata: created.metadata });
  assert.equal(renewed.externalId, 'channel-2');
  assert.equal(calls[1].url.endsWith('/channels/stop'), true);
  assert.equal(calls[2].url.endsWith('/events/watch'), true);
});

test('http scheduler adapter registers, lists and unregisters external schedules', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return response(200, { registrations: [{ automationId: 'a1', schedule: '0 9 * * *' }] });
    if (options.method === 'DELETE') return response(204);
    return response(200, { automationId: 'a1', schedule: '0 9 * * *' });
  };
  const scheduler = createHttpSchedulerAdapter({ baseUrl: 'https://scheduler.test/', token: 'sched-token', callbackUrl: 'https://naia.test/scheduler/occurrences', fetchImpl });
  await scheduler.register({ automationId: 'a1', schedule: '0 9 * * *', timezone: 'America/Sao_Paulo' });
  const registrationBody = JSON.parse(calls[0].options.body);
  assert.equal(registrationBody.callbackUrl, 'https://naia.test/scheduler/occurrences');
  assert.equal(calls[0].options.headers.authorization, 'Bearer sched-token');
  const listed = await scheduler.list();
  assert.equal(listed.length, 1);
  await scheduler.unregister('a1');
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('scheduler callback ingress authenticates and forwards resolved occurrence', async () => {
  const seen = [];
  const ingress = createSchedulerCallbackIngress({
    token: 'callback-token',
    bridge: { async occurrence(input) { seen.push(input); return { deduplicated: false, run: { automationId: input.automationId } }; } },
  });
  const unauthorized = await ingress.handle({ method: 'POST', headers: {}, body: { automationId: 'a1', scheduledFor: '2026-09-04T09:00:00-03:00' } });
  assert.equal(unauthorized.status, 401);
  const accepted = await ingress.handle({
    method: 'POST', headers: { authorization: 'Bearer callback-token' },
    body: { automationId: 'a1', scheduledFor: '2026-09-04T09:00:00-03:00', metadata: { source: 'external-scheduler' } },
  });
  assert.equal(accepted.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].automationId, 'a1');
  assert.equal(seen[0].metadata.source, 'external-scheduler');
});
