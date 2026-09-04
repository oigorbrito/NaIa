import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { AutomationTriggerKind } from '../../src/product/automations.mjs';
import { createAutomationRunStore, createAutomationTriggerRuntime } from '../../src/product/trigger-runtime.mjs';
import { createBearerIngressAuthenticator } from '../../src/product/trigger-ingress.mjs';
import { createGitHubWebhookAdapter, createGmailPushAdapter, createGoogleCalendarWebhookAdapter, createProviderWebhookIngress } from '../../src/product/provider-webhooks.mjs';
import { createProviderWebhookHttpServer } from '../../src/product/provider-webhook-server.mjs';
import { createScheduleSource } from '../../src/product/schedule-source.mjs';

function workflow(text = 'ok') {
  return { id: `wf-${text}`, steps: [{ id: 'echo', kind: 'ACTION', capability: 'text.echo', input: { text } }] };
}

async function setupAutomation(definition) {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation(definition);
  const runs = createAutomationRunStore();
  const runtime = createAutomationTriggerRuntime({ naia, runs });
  return { naia, runtime, runs };
}

test('github webhook validates x-hub-signature-256 and produces idempotent event delivery', async () => {
  const { runtime } = await setupAutomation({
    id: 'github-issues', name: 'GitHub issues', enabled: true,
    trigger: { kind: 'EVENT', event: 'github.issues', source: 'github' }, workflow: workflow('github'),
  });
  const secret = 'secret';
  const body = { action: 'opened', issue: { number: 1 } };
  const rawBody = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const ingress = createProviderWebhookIngress({ runtime, adapter: createGitHubWebhookAdapter({ secret }), automationId: 'github-issues' });
  const request = { method: 'POST', rawBody, body, headers: { 'x-hub-signature-256': signature, 'x-github-event': 'issues', 'x-github-delivery': 'delivery-1' } };
  const first = await ingress.handle(request);
  assert.equal(first.status, 202);
  assert.equal(first.body.objective.status, 'WAITING_CONFIRMATION');
  const duplicate = await ingress.handle(request);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.deduplicated, true);
  const rejected = await ingress.handle({ ...request, headers: { ...request.headers, 'x-hub-signature-256': 'sha256=bad' } });
  assert.equal(rejected.status, 401);
});

test('gmail push normalizes Pub/Sub message data and uses external ingress authentication', async () => {
  const { runtime } = await setupAutomation({
    id: 'gmail-change', name: 'Gmail change', enabled: true,
    trigger: { kind: 'EVENT', event: 'gmail.mailbox.changed', source: 'gmail' }, workflow: workflow('gmail'),
  });
  const ingress = createProviderWebhookIngress({
    runtime,
    adapter: createGmailPushAdapter(),
    automationId: 'gmail-change',
    authenticator: createBearerIngressAuthenticator({ token: 'ingress-token' }),
  });
  const push = { emailAddress: 'user@example.com', historyId: '123' };
  const response = await ingress.handle({
    method: 'POST', headers: { authorization: 'Bearer ingress-token' },
    body: { message: { messageId: 'msg-1', data: Buffer.from(JSON.stringify(push)).toString('base64') }, subscription: 'projects/p/subscriptions/s' },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.objective.status, 'WAITING_CONFIRMATION');
  assert.equal(response.body.provider, 'gmail');
});

test('google calendar webhook derives stable event identity from x-goog headers', async () => {
  const { runtime } = await setupAutomation({
    id: 'calendar-change', name: 'Calendar change', enabled: true,
    trigger: { kind: 'EVENT', event: 'google-calendar.exists', source: 'google-calendar' }, workflow: workflow('calendar'),
  });
  const ingress = createProviderWebhookIngress({
    runtime,
    adapter: createGoogleCalendarWebhookAdapter(),
    automationId: 'calendar-change',
    authenticator: createBearerIngressAuthenticator({ token: 'edge-token' }),
  });
  const request = {
    method: 'POST',
    headers: {
      authorization: 'Bearer edge-token',
      'x-goog-channel-id': 'channel-1',
      'x-goog-resource-id': 'resource-1',
      'x-goog-resource-state': 'exists',
      'x-goog-message-number': '42',
    },
    body: {},
  };
  const first = await ingress.handle(request);
  assert.equal(first.status, 202);
  const second = await ingress.handle(request);
  assert.equal(second.status, 200);
  assert.equal(second.body.deduplicated, true);
});

test('provider webhook HTTP router accepts a signed GitHub delivery', async () => {
  const { runtime } = await setupAutomation({
    id: 'github-http', name: 'GitHub HTTP', enabled: true,
    trigger: { kind: 'EVENT', event: 'github.issues', source: 'github' }, workflow: workflow('http'),
  });
  const secret = 'router-secret';
  const server = createProviderWebhookHttpServer({ runtime, adapters: { github: createGitHubWebhookAdapter({ secret }) }, port: 0 });
  const address = await server.start();
  try {
    const rawBody = JSON.stringify({ action: 'opened' });
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/github/github-http`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'issues', 'x-github-delivery': 'delivery-http-1' },
      body: rawBody,
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.objective.status, 'WAITING_CONFIRMATION');
  } finally {
    await server.stop();
  }
});

test('schedule source emits deterministic occurrence deliveries and deduplicates replay', async () => {
  const { naia, runtime } = await setupAutomation({
    id: 'daily-echo', name: 'Daily echo', enabled: true,
    trigger: { kind: AutomationTriggerKind.SCHEDULE, schedule: '0 9 * * *', timezone: 'America/Sao_Paulo' },
    workflow: workflow('daily'),
  });
  const source = createScheduleSource({ naia, runtime });
  const scheduledFor = '2026-09-04T09:00:00-03:00';
  const first = await source.emitOccurrence({ automationId: 'daily-echo', scheduledFor });
  assert.equal(first.deduplicated, false);
  assert.equal(first.objective.status, 'WAITING_CONFIRMATION');
  const second = await source.emitOccurrence({ automationId: 'daily-echo', scheduledFor });
  assert.equal(second.deduplicated, true);
});

test('schedule source emits only enabled schedule automations', async () => {
  const ports = createInMemoryPorts();
  const naia = createNaiaService(ports);
  await naia.createAutomation({ id: 'enabled-schedule', name: 'Enabled', enabled: true, trigger: { kind: 'SCHEDULE', schedule: '* * * * *' }, workflow: workflow('a') });
  await naia.createAutomation({ id: 'disabled-schedule', name: 'Disabled', enabled: false, trigger: { kind: 'SCHEDULE', schedule: '* * * * *' }, workflow: workflow('b') });
  await naia.createAutomation({ id: 'event-auto', name: 'Event', enabled: true, trigger: { kind: 'EVENT', event: 'x' }, workflow: workflow('c') });
  const runtime = createAutomationTriggerRuntime({ naia, runs: createAutomationRunStore() });
  const source = createScheduleSource({ naia, runtime });
  const rows = await source.emitDue({ scheduledFor: '2026-09-04T10:00:00Z' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run.automationId, 'enabled-schedule');
});
