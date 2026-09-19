function clone(value) { return structuredClone(value); }

function normalizeCapabilities(value = []) { return [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]; }
function hasAll(modelCaps, required) { const set = new Set(modelCaps); return required.every((cap) => set.has(cap)); }

export function createModelRegistry() {
  const models = new Map();
  const adapters = new Map();
  return {
    registerProvider(name, adapter) {
      const key = String(name ?? '').trim().toLowerCase();
      if (!key || !adapter || typeof adapter.complete !== 'function') throw new Error('provider name and complete adapter are required');
      adapters.set(key, adapter);
      return key;
    },
    registerModel(model) {
      const provider = String(model?.provider ?? '').trim().toLowerCase();
      const id = String(model?.id ?? '').trim();
      if (!provider || !id) throw new Error('model provider and id are required');
      if (!adapters.has(provider)) throw new Error('provider adapter not registered: ' + provider);
      const key = provider + ':' + id;
      models.set(key, {
        provider, id,
        class: model.class ?? 'standard',
        capabilities: normalizeCapabilities(model.capabilities),
        contextLimit: model.contextLimit ?? null,
        outputLimit: model.outputLimit ?? null,
        costRank: Number.isFinite(model.costRank) ? model.costRank : 100,
        latencyRank: Number.isFinite(model.latencyRank) ? model.latencyRank : 100,
        health: model.health ?? 'HEALTHY',
        available: model.available !== false,
      });
      return clone(models.get(key));
    },
    list() { return [...models.values()].map(clone); },
    adapter(provider) { return adapters.get(String(provider).toLowerCase()) ?? null; },
  };
}

function rankCandidates(models, { requiredCapabilities = [], modelClass = null, preferredProvider = null, pinned = null, policy = 'balanced' } = {}) {
  const required = normalizeCapabilities(requiredCapabilities);
  let candidates = models.filter((model) => model.available && model.health === 'HEALTHY' && hasAll(model.capabilities, required));
  if (modelClass) candidates = candidates.filter((model) => model.class === modelClass);
  if (pinned?.provider && pinned?.model) {
    const exact = candidates.find((model) => model.provider === String(pinned.provider).toLowerCase() && model.id === pinned.model);
    return exact ? [exact] : [];
  }
  candidates.sort((a, b) => {
    const prefA = preferredProvider && a.provider === String(preferredProvider).toLowerCase() ? -1000 : 0;
    const prefB = preferredProvider && b.provider === String(preferredProvider).toLowerCase() ? -1000 : 0;
    const scoreA = prefA + (policy === 'cost' ? a.costRank * 10 + a.latencyRank : policy === 'latency' ? a.latencyRank * 10 + a.costRank : a.costRank + a.latencyRank);
    const scoreB = prefB + (policy === 'cost' ? b.costRank * 10 + b.latencyRank : policy === 'latency' ? b.latencyRank * 10 + b.costRank : b.costRank + b.latencyRank);
    return scoreA - scoreB || (a.provider + ':' + a.id).localeCompare(b.provider + ':' + b.id);
  });
  return candidates;
}

export function createModelRouter({ registry, now = () => new Date().toISOString() } = {}) {
  if (!registry?.list || !registry?.adapter) throw new Error('model registry is required');
  return {
    async request(request, routing = {}) {
      const candidates = rankCandidates(registry.list(), routing);
      if (!candidates.length) {
        const error = new Error('no model satisfies routing requirements');
        error.code = 'NO_COMPATIBLE_MODEL';
        throw error;
      }

      const attempts = [];
      for (const model of candidates) {
        const adapter = registry.adapter(model.provider);
        const started = Date.now();
        try {
          const raw = await adapter.complete({ model: model.id, request: clone(request) });
          const latencyMs = Date.now() - started;
          return {
            provider: model.provider,
            model: raw?.model ?? model.id,
            modelClass: model.class,
            output: clone(raw?.output ?? raw?.content ?? null),
            toolCalls: clone(raw?.toolCalls ?? []),
            usage: clone(raw?.usage ?? null),
            latencyMs,
            routing: {
              reason: attempts.length ? 'fallback-after-failure' : (routing.pinned ? 'pinned-model' : routing.preferredProvider ? 'preferred-provider' : 'policy-ranked'),
              policy: routing.policy ?? 'balanced',
              requiredCapabilities: normalizeCapabilities(routing.requiredCapabilities),
              attempts: clone(attempts),
            },
            observedAt: now(),
          };
        } catch (error) {
          attempts.push({ provider: model.provider, model: model.id, code: error?.code ?? 'PROVIDER_ERROR', message: error?.message ?? String(error), retryable: Boolean(error?.retryable) });
        }
      }
      const error = new Error('all compatible models failed');
      error.code = 'ALL_MODELS_FAILED';
      error.attempts = attempts;
      throw error;
    },
  };
}

export function createFixtureModelAdapter({ name, fail = false, modelAlias = null, output = 'ok', usage = { inputTokens: 1, outputTokens: 1 }, secret = 'secret' } = {}) {
  return {
    name, secret,
    async complete({ model, request }) {
      if (fail) { const error = new Error(name + ' unavailable'); error.code = 'PROVIDER_UNAVAILABLE'; error.retryable = true; throw error; }
      return { model: modelAlias ?? model, output: typeof output === 'function' ? output(request) : output, usage: clone(usage), toolCalls: [] };
    },
  };
}
