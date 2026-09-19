import { randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }

export function createMemoryEmailStore() {
  const drafts = new Map();
  const sends = new Map();
  return {
    async saveDraft(draft) { drafts.set(draft.id, clone(draft)); return clone(draft); },
    async getDraft(id) { const value = drafts.get(id); return value ? clone(value) : null; },
    async saveSend(key, record) { sends.set(key, clone(record)); return clone(record); },
    async getSend(key) { const value = sends.get(key); return value ? clone(value) : null; },
  };
}

export function createFixtureEmailProvider({
  name = 'email_fixture',
  messages = [],
  failSend = null,
  token = 'fixture-secret-token',
} = {}) {
  const sent = [];
  return {
    name, token,
    async search({ query = '' } = {}) {
      const q = String(query).toLowerCase();
      return messages.filter((m) => [m.subject, m.from, m.to, m.body].some((v) => String(v ?? '').toLowerCase().includes(q))).map((m) => ({ id: m.id, from: m.from, to: m.to, subject: m.subject, date: m.date ?? null }));
    },
    async read({ messageId }) {
      const message = messages.find((m) => String(m.id) === String(messageId));
      if (!message) { const error = new Error('message not found'); error.code = 'NOT_FOUND'; throw error; }
      return clone(message);
    },
    async send(input) {
      if (failSend) {
        const error = new Error(failSend.message ?? 'send failed');
        error.code = failSend.code ?? 'PROVIDER_ERROR';
        error.retryable = Boolean(failSend.retryable);
        throw error;
      }
      const message = { id: 'sent-' + (sent.length + 1), ...clone(input) };
      sent.push(message);
      return clone(message);
    },
    sent() { return clone(sent); },
  };
}

export function createEmailService({ store = createMemoryEmailStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  return {
    async search({ provider, query }) {
      try { return { messages: await provider.search({ query }), provider: provider.name ?? 'email' }; }
      catch (error) { const e = new Error(error?.message ?? 'email search failed'); e.code = error?.code ?? 'PROVIDER_ERROR'; e.retryable = Boolean(error?.retryable); throw e; }
    },

    async read({ provider, messageId }) {
      try { return { message: await provider.read({ messageId }), provider: provider.name ?? 'email' }; }
      catch (error) { const e = new Error(error?.message ?? 'email read failed'); e.code = error?.code ?? 'PROVIDER_ERROR'; e.retryable = Boolean(error?.retryable); throw e; }
    },

    async draft({ to, subject, body, inReplyTo = null }) {
      if (!String(to ?? '').trim()) throw new Error('recipient is required');
      const draft = { id: idFactory(), to: String(to).trim(), subject: String(subject ?? '').trim(), body: String(body ?? ''), inReplyTo, createdAt: now() };
      await store.saveDraft(draft);
      return clone(draft);
    },

    async send({ provider, draftId = null, to = null, subject = '', body = '', inReplyTo = null, idempotencyKey }) {
      if (!idempotencyKey) throw new Error('idempotencyKey is required');
      const existing = await store.getSend(idempotencyKey);
      if (existing) return { duplicate: true, ...clone(existing) };
      let payload = { to, subject, body, inReplyTo };
      if (draftId) {
        const draft = await store.getDraft(draftId);
        if (!draft) throw new Error('draft not found: ' + draftId);
        payload = { to: draft.to, subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo };
      }
      if (!String(payload.to ?? '').trim()) throw new Error('recipient is required');
      try {
        const message = await provider.send(payload);
        const record = { message, provider: provider.name ?? 'email', sentAt: now() };
        await store.saveSend(idempotencyKey, record);
        return { duplicate: false, ...clone(record) };
      } catch (error) {
        const e = new Error(error?.message ?? 'email send failed');
        e.code = error?.code ?? 'PROVIDER_ERROR';
        e.retryable = Boolean(error?.retryable);
        throw e;
      }
    },
  };
}

export function registerEmailCapabilities(naia, { service, provider }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !provider) throw new Error('email service/provider are required');
  return [
    naia.registerCapability({
      name: 'email.search',
      tool: { risk: 'SENSITIVE', capability: 'email.read', description: 'Searches connected email', async run(input) { return service.search({ provider, ...input }); } },
      rule: { name: 'email-search', match: ({ title }) => /email|gmail/i.test(String(title ?? '')) && /procure|busque|search|find/i.test(String(title ?? '')), action: ({ title }) => ({ tool: 'email.search', input: { query: String(title ?? '') }, risk: 'SENSITIVE', requiresApproval: true }) },
    }),
    naia.registerCapability({
      name: 'email.read',
      tool: { risk: 'SENSITIVE', capability: 'email.read', description: 'Reads a connected email message', async run(input) { return service.read({ provider, ...input }); } },
      rule: { name: 'email-read', match: ({ title }) => /email|gmail/i.test(String(title ?? '')) && /leia|read|abrir|open/i.test(String(title ?? '')), action: ({ id }) => ({ tool: 'email.read', input: { messageId: id }, risk: 'SENSITIVE', requiresApproval: true }) },
    }),
    naia.registerCapability({
      name: 'email.send',
      tool: { risk: 'EXTERNAL_WRITE', capability: 'email.send', description: 'Sends an email after explicit approval', async run(input) { return service.send({ provider, ...input }); } },
      rule: { name: 'email-send', match: ({ title }) => /envie|mande|send|forward/i.test(String(title ?? '')) && /email|gmail/i.test(String(title ?? '')), action: ({ id, title }) => ({ tool: 'email.send', input: { body: String(title ?? ''), idempotencyKey: id }, risk: 'EXTERNAL_WRITE', requiresApproval: true }) },
    }),
  ];
}
