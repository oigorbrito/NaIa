import { createFileProviderSubscriptionStore, createProviderSubscriptionManager } from './provider-subscriptions.mjs';
import { createLiveProviderSubscriptionAdapters } from './live-control-plane-binding.mjs';
import { createGitHubWebhookControlClient, createGmailWatchControlClient, createGoogleCalendarChannelControlClient } from './live-provider-control-plane.mjs';
import { createFileControlPlaneJournal } from './control-plane-journal.mjs';
import { createControlPlaneOperations } from './control-plane-operations.mjs';
import { createHttpSchedulerAdapter } from './http-scheduler-adapter.mjs';
import { createSchedulerAdapter, createSchedulerBridge } from './scheduler-adapter.mjs';
import { createScheduleSource } from './schedule-source.mjs';
import { createGitHubWebhookRemoteProbe, createRemoteSubscriptionProbeRegistry, createSubscriptionReconciler, createUnverifiableRemoteProbe } from './remote-state-reconciliation.mjs';

function value(env, name) { return String(env?.[name] ?? '').trim(); }

function createUnconfiguredScheduler() {
  return createSchedulerAdapter({
    async register() { throw new Error('external scheduler is not configured'); },
    async unregister() { throw new Error('external scheduler is not configured'); },
    async list() { throw new Error('external scheduler is not configured'); },
  });
}

export function createOperationalControlPlane({ rootDir = '.naia', naia, triggerRuntime, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!naia?.automations) throw new Error('naia service is required');
  if (!triggerRuntime?.dispatch) throw new Error('trigger runtime is required');

  const githubToken = value(env, 'NAIA_GITHUB_TOKEN') || value(env, 'GITHUB_TOKEN');
  const githubSecret = value(env, 'NAIA_GITHUB_WEBHOOK_SECRET');
  const gmailToken = value(env, 'NAIA_GMAIL_ACCESS_TOKEN');
  const calendarToken = value(env, 'NAIA_CALENDAR_ACCESS_TOKEN');
  const calendarChannelToken = value(env, 'NAIA_CALENDAR_CHANNEL_TOKEN');

  const clients = {};
  if (githubToken && githubSecret) clients.github = createGitHubWebhookControlClient({ fetchImpl, token: githubToken, webhookSecret: githubSecret });
  if (gmailToken) clients.gmail = createGmailWatchControlClient({ fetchImpl, accessToken: gmailToken });
  if (calendarToken) clients.calendar = createGoogleCalendarChannelControlClient({ fetchImpl, accessToken: calendarToken, channelToken: calendarChannelToken });

  const subscriptions = createProviderSubscriptionManager({
    store: createFileProviderSubscriptionStore({ rootDir }),
    adapters: createLiveProviderSubscriptionAdapters(clients),
  });

  const probes = [];
  if (githubToken) probes.push(createGitHubWebhookRemoteProbe({ fetchImpl, token: githubToken }));
  probes.push(createUnverifiableRemoteProbe('gmail'));
  probes.push(createUnverifiableRemoteProbe('google-calendar'));
  const reconciler = createSubscriptionReconciler({ subscriptions, probes: createRemoteSubscriptionProbeRegistry(probes) });

  const schedulerUrl = value(env, 'NAIA_SCHEDULER_URL');
  const schedulerCallbackUrl = value(env, 'NAIA_SCHEDULER_CALLBACK_URL');
  const scheduler = schedulerUrl && schedulerCallbackUrl
    ? createHttpSchedulerAdapter({ baseUrl: schedulerUrl, token: value(env, 'NAIA_SCHEDULER_TOKEN'), callbackUrl: schedulerCallbackUrl, fetchImpl })
    : createUnconfiguredScheduler();
  const scheduleSource = createScheduleSource({ naia, runtime: triggerRuntime });
  const schedulerBridge = createSchedulerBridge({ naia, scheduler, scheduleSource });
  const operations = createControlPlaneOperations({ subscriptions, schedulerBridge, journal: createFileControlPlaneJournal({ rootDir }) });

  return { clients: Object.keys(clients), subscriptions, reconciler, operations, schedulerConfigured: Boolean(schedulerUrl && schedulerCallbackUrl) };
}
