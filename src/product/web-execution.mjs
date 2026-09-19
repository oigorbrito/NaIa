import { createHash, randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }
function hostnameOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }
function stableFingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function compareWebOptions(options, { priceWeight = 1, feeWeight = 1 } = {}) {
  return [...(options ?? [])].map((option) => {
    const price = Number(option.price ?? 0);
    const fees = Number(option.fees ?? 0);
    const total = (Number.isFinite(price) ? price : 0) * priceWeight + (Number.isFinite(fees) ? fees : 0) * feeWeight;
    return { ...clone(option), total: Number(total.toFixed(2)) };
  }).sort((a, b) => a.total - b.total || String(a.id).localeCompare(String(b.id)));
}

export function createMemoryWebExecutionStore() {
  const runs = new Map();
  const commits = new Map();
  return {
    async saveRun(run) { runs.set(run.id, clone(run)); return clone(run); },
    async getRun(id) { const value = runs.get(id); return value ? clone(value) : null; },
    async getCommit(key) { const value = commits.get(key); return value ? clone(value) : null; },
    async saveCommit(key, value) { commits.set(key, clone(value)); return clone(value); },
  };
}

export function createFixtureWebAdapter({
  searchResults = {},
  forms = {},
  failSearchTimes = 0,
} = {}) {
  let remainingFailures = failSearchTimes;
  const submissions = [];
  const mutableForms = new Map(Object.entries(forms).map(([id, form]) => [id, clone(form)]));
  return {
    async search({ query }) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        const error = new Error('navigation failed');
        error.code = 'NAVIGATION_FAILED';
        error.retryable = true;
        throw error;
      }
      return clone(searchResults[query] ?? []);
    },
    async previewForm({ targetId, fields }) {
      const form = mutableForms.get(targetId);
      if (!form) { const error = new Error('form not found'); error.code = 'NOT_FOUND'; throw error; }
      return {
        targetId,
        url: form.url,
        revision: String(form.revision ?? '1'),
        fields: clone(fields),
        summary: form.summary ?? null,
        irreversible: form.irreversible !== false,
      };
    },
    async submitForm({ targetId, fields, expectedRevision, idempotencyKey }) {
      const prior = submissions.find((row) => row.idempotencyKey === idempotencyKey);
      if (prior) return clone(prior.result);
      const form = mutableForms.get(targetId);
      if (!form) { const error = new Error('form not found'); error.code = 'NOT_FOUND'; throw error; }
      if (String(form.revision ?? '1') !== String(expectedRevision)) {
        const error = new Error('page changed since approval');
        error.code = 'STALE_PAGE';
        error.retryable = false;
        error.currentRevision = String(form.revision ?? '1');
        throw error;
      }
      const result = { confirmationId: 'confirmation-' + (submissions.length + 1), targetId, fields: clone(fields), revision: String(expectedRevision) };
      submissions.push({ idempotencyKey, result: clone(result) });
      return result;
    },
    setRevision(targetId, revision) { const form = mutableForms.get(targetId); if (form) form.revision = revision; },
    submissions() { return clone(submissions); },
  };
}

export function createWebExecutionService({
  store = createMemoryWebExecutionStore(),
  adapter,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  if (!adapter || typeof adapter.search !== 'function' || typeof adapter.previewForm !== 'function' || typeof adapter.submitForm !== 'function') {
    throw new Error('web execution adapter is required');
  }

  async function requireRun(id) {
    const run = await store.getRun(id);
    if (!run) throw new Error('web run not found: ' + id);
    return run;
  }

  function assertActive(run) {
    if (run.state === 'CANCELLED') { const error = new Error('web run cancelled'); error.code = 'CANCELLED'; throw error; }
    if (run.state === 'COMPLETED') { const error = new Error('web run completed'); error.code = 'COMPLETED'; throw error; }
  }

  function assertAllowed(run, url) {
    const host = hostnameOf(url);
    if (!host) { const error = new Error('invalid web target URL'); error.code = 'INVALID_URL'; throw error; }
    if (run.allowedDomains.length && !run.allowedDomains.some((domain) => host === domain || host.endsWith('.' + domain))) {
      const error = new Error('web domain not allowed: ' + host);
      error.code = 'DOMAIN_BLOCKED';
      throw error;
    }
  }

  async function evidence(run, type, details = {}) {
    run.evidence.push({ type, timestamp: now(), ...clone(details) });
    run.updatedAt = now();
    await store.saveRun(run);
  }

  return {
    async createRun({ userId, objective, allowedDomains = [] }) {
      if (!userId || !String(objective ?? '').trim()) throw new Error('userId and objective are required');
      const run = {
        id: idFactory(), userId, objective: String(objective).trim(),
        allowedDomains: [...new Set(allowedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean))],
        state: 'ACTIVE', pendingSubmission: null, approvedFingerprint: null, evidence: [],
        createdAt: now(), updatedAt: now(),
      };
      await store.saveRun(run);
      await evidence(run, 'WEB_RUN_CREATED');
      return clone(run);
    },

    async search(runId, { query }) {
      const run = await requireRun(runId);
      assertActive(run);
      try {
        const raw = await adapter.search({ query });
        const options = [];
        for (const item of raw ?? []) {
          if (item.url) assertAllowed(run, item.url);
          options.push(clone(item));
        }
        await evidence(run, 'WEB_SEARCH_COMPLETED', { query, resultCount: options.length });
        return { options, comparison: compareWebOptions(options) };
      } catch (error) {
        await evidence(run, 'WEB_SEARCH_FAILED', { query, code: error?.code ?? 'SEARCH_FAILED', retryable: Boolean(error?.retryable) });
        throw error;
      }
    },

    async prepareForm(runId, { targetId, fields }) {
      const run = await requireRun(runId);
      assertActive(run);
      const preview = await adapter.previewForm({ targetId, fields: clone(fields ?? {}) });
      assertAllowed(run, preview.url);
      const fingerprint = stableFingerprint({ targetId, fields: preview.fields, revision: preview.revision, url: preview.url });
      run.pendingSubmission = { targetId, fields: clone(preview.fields), revision: preview.revision, url: preview.url, fingerprint, status: 'WAITING_APPROVAL' };
      run.approvedFingerprint = null;
      run.state = 'WAITING_APPROVAL';
      await evidence(run, 'WEB_SUBMISSION_PREPARED', { targetId, fingerprint, revision: preview.revision, summary: preview.summary, irreversible: preview.irreversible });
      return { ...clone(preview), fingerprint, requiresApproval: true };
    },

    async approve(runId, fingerprint) {
      const run = await requireRun(runId);
      if (!run.pendingSubmission || run.pendingSubmission.fingerprint !== fingerprint) {
        const error = new Error('approval does not match current submission');
        error.code = 'APPROVAL_MISMATCH';
        throw error;
      }
      run.approvedFingerprint = fingerprint;
      run.pendingSubmission.status = 'APPROVED';
      run.state = 'ACTIVE';
      await evidence(run, 'WEB_SUBMISSION_APPROVED', { fingerprint });
      return clone(run.pendingSubmission);
    },

    async submit(runId, { fingerprint, idempotencyKey }) {
      const run = await requireRun(runId);
      assertActive(run);
      if (!idempotencyKey) throw new Error('idempotencyKey is required');
      const prior = await store.getCommit(idempotencyKey);
      if (prior) return { duplicate: true, ...clone(prior) };
      const pending = run.pendingSubmission;
      if (!pending || pending.fingerprint !== fingerprint || run.approvedFingerprint !== fingerprint) {
        const error = new Error('submission requires matching approval');
        error.code = 'APPROVAL_REQUIRED';
        throw error;
      }
      try {
        const result = await adapter.submitForm({ targetId: pending.targetId, fields: pending.fields, expectedRevision: pending.revision, idempotencyKey });
        const commit = { runId, fingerprint, result: clone(result), committedAt: now() };
        await store.saveCommit(idempotencyKey, commit);
        run.state = 'COMPLETED';
        pending.status = 'COMPLETED';
        await evidence(run, 'WEB_SUBMISSION_COMPLETED', { fingerprint, confirmationId: result?.confirmationId ?? null });
        return { duplicate: false, ...clone(commit) };
      } catch (error) {
        if (error?.code === 'STALE_PAGE') {
          run.state = 'WAITING_REVIEW';
          run.approvedFingerprint = null;
          pending.status = 'STALE';
        }
        await evidence(run, 'WEB_SUBMISSION_FAILED', { fingerprint, code: error?.code ?? 'SUBMIT_FAILED', retryable: Boolean(error?.retryable) });
        throw error;
      }
    },

    async cancel(runId) {
      const run = await requireRun(runId);
      if (run.state === 'COMPLETED') return clone(run);
      run.state = 'CANCELLED';
      run.approvedFingerprint = null;
      if (run.pendingSubmission) run.pendingSubmission.status = 'CANCELLED';
      await evidence(run, 'WEB_RUN_CANCELLED');
      return clone(run);
    },

    async get(runId) { return requireRun(runId); },
  };
}

export function registerWebExecutionCapabilities(naia, { service }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service) throw new Error('web execution service is required');
  return [
    naia.registerCapability({
      name: 'web.search',
      tool: { risk: 'READ_ONLY', capability: 'web.execution', description: 'Searches and compares structured web options', async run(input) { return service.search(input.runId, { query: input.query }); } },
      rule: { name: 'web-search', match: ({ title }) => /pesquise|compare|search|compare/i.test(String(title ?? '')), action: ({ id, title }) => ({ tool: 'web.search', input: { runId: id, query: title }, risk: 'READ_ONLY', requiresApproval: false }) },
    }),
    naia.registerCapability({
      name: 'web.submit',
      tool: { risk: 'EXTERNAL_WRITE', capability: 'web.execution', description: 'Submits one previously previewed and approved web mutation', async run(input) { return service.submit(input.runId, input); } },
      rule: { name: 'web-submit', match: ({ title }) => /enviar formul[aá]rio|confirmar reserva|submit form|book/i.test(String(title ?? '')), action: ({ id }) => ({ tool: 'web.submit', input: { runId: id }, risk: 'EXTERNAL_WRITE', requiresApproval: true }) },
    }),
  ];
}
