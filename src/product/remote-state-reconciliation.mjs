export const RemoteSubscriptionState = Object.freeze({
  PRESENT: 'PRESENT',
  MISSING: 'MISSING',
  UNKNOWN: 'UNKNOWN',
  ERROR: 'ERROR',
});

export const SubscriptionDriftKind = Object.freeze({
  MISSING_REMOTE: 'MISSING_REMOTE',
  ORPHAN_REMOTE: 'ORPHAN_REMOTE',
  EXTERNAL_ID_DRIFT: 'EXTERNAL_ID_DRIFT',
  CALLBACK_DRIFT: 'CALLBACK_DRIFT',
  REMOTE_PROBE_ERROR: 'REMOTE_PROBE_ERROR',
  REMOTE_UNVERIFIABLE: 'REMOTE_UNVERIFIABLE',
});

function clone(value) { return value == null ? value : structuredClone(value); }

export function createRemoteSubscriptionProbe({ provider, inspect } = {}) {
  const name = String(provider ?? '').trim();
  if (!name) throw new Error('remote probe provider is required');
  if (typeof inspect !== 'function') throw new Error('remote probe inspect is required');
  return { provider: name, inspect };
}

export function createRemoteSubscriptionProbeRegistry(probes = []) {
  const byProvider = new Map(probes.map((probe) => [probe.provider, probe]));
  return {
    providers() { return [...byProvider.keys()]; },
    async inspect(subscription) {
      const probe = byProvider.get(String(subscription?.provider ?? ''));
      if (!probe) return { state: RemoteSubscriptionState.UNKNOWN, reason: 'probe-unavailable' };
      try {
        const result = await probe.inspect(clone(subscription));
        const state = String(result?.state ?? RemoteSubscriptionState.UNKNOWN).toUpperCase();
        if (!Object.values(RemoteSubscriptionState).includes(state)) throw new Error(`invalid remote state: ${state}`);
        return { ...clone(result), state };
      } catch (error) {
        return { state: RemoteSubscriptionState.ERROR, error: error?.message ?? String(error) };
      }
    },
  };
}

export function createGitHubWebhookRemoteProbe({ fetchImpl = globalThis.fetch, token, apiBase = 'https://api.github.com' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const authToken = String(token ?? '').trim();
  if (!authToken) throw new Error('github token is required');
  return createRemoteSubscriptionProbe({
    provider: 'github',
    async inspect(subscription) {
      const repository = String(subscription.metadata?.repository ?? '').trim();
      const externalId = String(subscription.externalId ?? '').trim();
      if (!repository || !externalId) return { state: RemoteSubscriptionState.UNKNOWN, reason: 'missing-local-identity' };
      const response = await fetchImpl(`${apiBase}/repos/${repository}/hooks/${encodeURIComponent(externalId)}`, {
        method: 'GET', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${authToken}` },
      });
      if (response.status === 404) return { state: RemoteSubscriptionState.MISSING };
      const text = await response.text();
      let body = {};
      if (text) { try { body = JSON.parse(text); } catch { body = {}; } }
      if (!response.ok) throw new Error(`github webhook inspect failed: ${body?.message ?? response.status}`);
      return {
        state: RemoteSubscriptionState.PRESENT,
        externalId: body.id != null ? String(body.id) : externalId,
        callbackUrl: body.config?.url ? String(body.config.url) : null,
        active: body.active !== false,
        events: Array.isArray(body.events) ? body.events.map(String) : [],
      };
    },
  });
}

export function createUnverifiableRemoteProbe(provider, reason = 'provider-does-not-expose-watch-read-api') {
  return createRemoteSubscriptionProbe({ provider, async inspect() { return { state: RemoteSubscriptionState.UNKNOWN, reason }; } });
}

export function createSubscriptionReconciler({ subscriptions, probes } = {}) {
  if (!subscriptions?.list || !subscriptions?.recreate || !subscriptions?.stop) throw new Error('subscription manager with list/recreate/stop is required');
  if (!probes?.inspect) throw new Error('remote probe registry is required');

  async function inspectOne(local) {
    const remote = await probes.inspect(local);
    const findings = [];
    if (remote.state === RemoteSubscriptionState.ERROR) findings.push({ kind: SubscriptionDriftKind.REMOTE_PROBE_ERROR, message: remote.error ?? null });
    else if (remote.state === RemoteSubscriptionState.UNKNOWN) findings.push({ kind: SubscriptionDriftKind.REMOTE_UNVERIFIABLE, message: remote.reason ?? null });
    else if (local.status === 'STOPPED' && remote.state === RemoteSubscriptionState.PRESENT) findings.push({ kind: SubscriptionDriftKind.ORPHAN_REMOTE });
    else if (local.status !== 'STOPPED' && remote.state === RemoteSubscriptionState.MISSING) findings.push({ kind: SubscriptionDriftKind.MISSING_REMOTE });

    if (remote.state === RemoteSubscriptionState.PRESENT) {
      if (remote.externalId && local.externalId && String(remote.externalId) !== String(local.externalId)) findings.push({ kind: SubscriptionDriftKind.EXTERNAL_ID_DRIFT, local: local.externalId, remote: remote.externalId });
      if (remote.callbackUrl && local.callbackUrl && String(remote.callbackUrl) !== String(local.callbackUrl)) findings.push({ kind: SubscriptionDriftKind.CALLBACK_DRIFT, local: local.callbackUrl, remote: remote.callbackUrl });
    }
    return { subscription: clone(local), remote: clone(remote), findings };
  }

  async function reconcile(filter = {}) {
    const rows = await subscriptions.list(filter);
    const items = [];
    for (const row of rows) items.push(await inspectOne(row));
    const actionable = items.flatMap((item) => item.findings.filter((finding) => ![SubscriptionDriftKind.REMOTE_UNVERIFIABLE, SubscriptionDriftKind.REMOTE_PROBE_ERROR].includes(finding.kind)).map((finding) => ({ subscriptionId: item.subscription.id, provider: item.subscription.provider, automationId: item.subscription.automationId, ...finding })));
    return { healthy: actionable.length === 0, scanned: rows.length, actionable, items };
  }

  async function repair(report = null) {
    const current = report ?? await reconcile();
    const repaired = [];
    const failed = [];
    const seen = new Set();
    for (const finding of current.actionable) {
      if (seen.has(finding.subscriptionId)) continue;
      seen.add(finding.subscriptionId);
      try {
        if (finding.kind === SubscriptionDriftKind.ORPHAN_REMOTE) repaired.push(await subscriptions.stop(finding.subscriptionId));
        else repaired.push(await subscriptions.recreate(finding.subscriptionId));
      } catch (error) {
        failed.push({ subscriptionId: finding.subscriptionId, kind: finding.kind, error: error?.message ?? String(error) });
      }
    }
    return { scanned: current.scanned, repaired, failed };
  }

  return { inspectOne, reconcile, repair };
}
