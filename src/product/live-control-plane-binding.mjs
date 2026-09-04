import {
  createGitHubWebhookSubscriptionAdapter,
  createGmailWatchSubscriptionAdapter,
  createGoogleCalendarChannelAdapter,
} from './provider-subscriptions.mjs';

function assertClient(client, label) {
  if (!client || typeof client.create !== 'function' || typeof client.renew !== 'function' || typeof client.stop !== 'function') {
    throw new Error(`${label} control client must implement create/renew/stop`);
  }
  return client;
}

export function createLiveProviderSubscriptionAdapters({ github, gmail, calendar } = {}) {
  const adapters = [];
  if (github) {
    const client = assertClient(github, 'github');
    adapters.push(createGitHubWebhookSubscriptionAdapter({
      create: (input) => client.create(input),
      renew: (subscription) => client.renew(subscription),
      stop: (subscription) => client.stop(subscription),
    }));
  }
  if (gmail) {
    const client = assertClient(gmail, 'gmail');
    adapters.push(createGmailWatchSubscriptionAdapter({
      create: (input) => client.create(input),
      renew: (subscription) => client.renew(subscription),
      stop: (subscription) => client.stop(subscription),
    }));
  }
  if (calendar) {
    const client = assertClient(calendar, 'google-calendar');
    adapters.push(createGoogleCalendarChannelAdapter({
      create: (input) => client.create(input),
      renew: (subscription) => client.renew(subscription),
      stop: (subscription) => client.stop(subscription),
    }));
  }
  return adapters;
}
