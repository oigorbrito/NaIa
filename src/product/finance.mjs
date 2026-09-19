import { randomUUID } from 'node:crypto';

const CONSENT_STATES = new Set(['ACTIVE', 'EXPIRED', 'REVOKED']);
const TX_STATUSES = new Set(['PENDING', 'POSTED']);

function clone(value) { return structuredClone(value); }
function normalizeProvider(value) { return String(value ?? '').trim().toLowerCase(); }
function normalizeCurrency(value) { return String(value ?? 'BRL').trim().toUpperCase(); }
function round(value, digits = 2) { return Number(Number(value ?? 0).toFixed(digits)); }
function monthKey(iso) { return String(iso).slice(0, 7); }

export function createMemoryFinanceStore() {
  const connections = new Map();
  const accounts = new Map();
  const transactions = new Map();
  const providerIndex = new Map();
  const budgets = new Map();
  return {
    async saveConnection(connection) { connections.set(connection.id, clone(connection)); return clone(connection); },
    async getConnection(id) { const value = connections.get(id); return value ? clone(value) : null; },
    async saveAccount(account) { accounts.set(account.id, clone(account)); return clone(account); },
    async listAccounts({ userId } = {}) { return [...accounts.values()].filter((row) => !userId || row.userId === userId).map(clone); },
    async saveTransaction(transaction) {
      transactions.set(transaction.id, clone(transaction));
      providerIndex.set(transaction.userId + ':' + transaction.provider + ':' + transaction.providerTransactionId, transaction.id);
      return clone(transaction);
    },
    async findTransactionByProviderId(userId, provider, providerTransactionId) {
      const id = providerIndex.get(userId + ':' + normalizeProvider(provider) + ':' + providerTransactionId);
      return id ? clone(transactions.get(id)) : null;
    },
    async getTransaction(id) { const value = transactions.get(id); return value ? clone(value) : null; },
    async listTransactions({ userId, from, to } = {}) {
      return [...transactions.values()].filter((row) => {
        if (userId && row.userId !== userId) return false;
        if (from && row.bookedAt < from) return false;
        if (to && row.bookedAt > to) return false;
        return true;
      }).map(clone);
    },
    async saveBudget(budget) { budgets.set(budget.id, clone(budget)); return clone(budget); },
    async listBudgets({ userId, month } = {}) {
      return [...budgets.values()].filter((row) => (!userId || row.userId === userId) && (!month || row.month === month)).map(clone);
    },
  };
}

export function createFixtureFinanceProvider({
  name,
  accounts = [],
  transactions = [],
  balances = {},
  consentState = 'ACTIVE',
  failWith = null,
} = {}) {
  if (!name) throw new Error('provider name is required');
  if (!CONSENT_STATES.has(consentState)) throw new Error('unsupported consent state: ' + consentState);
  return {
    name,
    async snapshot() {
      if (failWith) {
        const error = new Error(failWith.message ?? 'provider failure');
        error.code = failWith.code ?? 'PROVIDER_UNAVAILABLE';
        error.retryable = Boolean(failWith.retryable);
        throw error;
      }
      return { consentState, accounts: clone(accounts), transactions: clone(transactions), balances: clone(balances) };
    },
  };
}

function assertConsentActive(snapshot) {
  if (snapshot.consentState !== 'ACTIVE') {
    const error = new Error('finance consent is not active: ' + snapshot.consentState);
    error.code = 'CONSENT_' + snapshot.consentState;
    error.retryable = false;
    throw error;
  }
}

function normalizeAccount({ userId, connectionId, provider, raw, balance }) {
  if (!raw?.id) throw new Error('provider account id is required');
  return {
    id: provider + ':' + raw.id,
    userId, connectionId, provider, providerAccountId: raw.id,
    institution: raw.institution ?? null,
    type: raw.type ?? 'UNKNOWN',
    currency: normalizeCurrency(raw.currency),
    balance: Number.isFinite(balance) ? round(balance) : null,
    source: { provider, providerAccountId: raw.id },
  };
}

function normalizeTransaction({ userId, connectionId, provider, raw, idFactory }) {
  if (!raw?.id) throw new Error('provider transaction id is required');
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount)) throw new Error('transaction amount must be finite');
  const status = String(raw.status ?? 'POSTED').toUpperCase();
  if (!TX_STATUSES.has(status)) throw new Error('unsupported transaction status: ' + status);
  return {
    id: idFactory(), userId, connectionId, provider, providerTransactionId: raw.id,
    accountId: provider + ':' + raw.accountId,
    amount: round(amount), currency: normalizeCurrency(raw.currency),
    direction: amount < 0 ? 'OUTFLOW' : 'INFLOW',
    bookedAt: raw.bookedAt,
    merchant: raw.merchant ?? null, description: raw.description ?? null,
    status, providerCategory: raw.category ?? null,
    inferredCategory: raw.inferredCategory ?? null,
    categoryConfidence: raw.categoryConfidence ?? null,
    userCategoryOverride: null,
    source: { provider, providerTransactionId: raw.id },
  };
}

export function createFinanceService({ store = createMemoryFinanceStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  async function importProviderSnapshot({ userId, providerAdapter }) {
    if (!userId) throw new Error('userId is required');
    if (!providerAdapter || typeof providerAdapter.snapshot !== 'function') throw new Error('finance provider adapter is required');
    const provider = normalizeProvider(providerAdapter.name);
    let snapshot;
    try { snapshot = await providerAdapter.snapshot(); }
    catch (error) {
      const wrapped = new Error(error?.message ?? 'finance provider failed');
      wrapped.code = error?.code ?? 'PROVIDER_ERROR';
      wrapped.retryable = Boolean(error?.retryable);
      throw wrapped;
    }
    assertConsentActive(snapshot);
    const connectionId = provider + ':' + userId;
    await store.saveConnection({ id: connectionId, userId, provider, consentState: snapshot.consentState, importedAt: now() });

    const normalizedAccounts = [];
    for (const raw of snapshot.accounts ?? []) {
      const account = normalizeAccount({ userId, connectionId, provider, raw, balance: snapshot.balances?.[raw.id] });
      await store.saveAccount(account);
      normalizedAccounts.push(account);
    }

    let imported = 0;
    let duplicates = 0;
    for (const raw of snapshot.transactions ?? []) {
      const existing = await store.findTransactionByProviderId(userId, provider, raw.id);
      if (existing) { duplicates += 1; continue; }
      const transaction = normalizeTransaction({ userId, connectionId, provider, raw, idFactory });
      await store.saveTransaction(transaction);
      imported += 1;
    }

    return { provider, connectionId, accounts: normalizedAccounts, importedTransactions: imported, duplicateTransactions: duplicates };
  }

  async function spendingByCategory({ userId, month, category = null }) {
    const rows = await store.listTransactions({ userId });
    const filtered = rows.filter((tx) => tx.status === 'POSTED' && tx.direction === 'OUTFLOW' && monthKey(tx.bookedAt) === month);
    const normalizedCategory = category ? String(category).toLowerCase() : null;
    const selected = normalizedCategory ? filtered.filter((tx) =>
      String(tx.userCategoryOverride ?? tx.inferredCategory ?? tx.providerCategory ?? 'uncategorized').toLowerCase() === normalizedCategory
    ) : filtered;
    return round(selected.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));
  }

  return {
    importProviderSnapshot,

    async balances(userId) {
      const accounts = await store.listAccounts({ userId });
      const byCurrency = {};
      for (const account of accounts) {
        if (!Number.isFinite(account.balance)) continue;
        byCurrency[account.currency] = round((byCurrency[account.currency] ?? 0) + account.balance);
      }
      return { accounts, totals: byCurrency };
    },

    async spending({ userId, month = monthKey(now()), category = null }) {
      return { month, category, amount: await spendingByCategory({ userId, month, category }) };
    },

    async correctCategory(transactionId, category) {
      const transaction = await store.getTransaction(transactionId);
      if (!transaction) throw new Error('transaction not found: ' + transactionId);
      transaction.userCategoryOverride = String(category ?? '').trim() || null;
      await store.saveTransaction(transaction);
      return clone(transaction);
    },

    async setBudget({ userId, month, category, amount, currency = 'BRL' }) {
      if (!userId || !month || !category || !Number.isFinite(Number(amount))) throw new Error('invalid budget');
      const budget = { id: userId + ':' + month + ':' + String(category).toLowerCase(), userId, month, category, amount: round(Number(amount)), currency: normalizeCurrency(currency) };
      await store.saveBudget(budget);
      return clone(budget);
    },

    async budgetStatus({ userId, month = monthKey(now()) }) {
      const budgets = await store.listBudgets({ userId, month });
      const status = [];
      for (const budget of budgets) {
        const actual = await spendingByCategory({ userId, month, category: budget.category });
        status.push({ ...budget, actual, remaining: round(budget.amount - actual), utilization: budget.amount === 0 ? null : round(actual / budget.amount, 4) });
      }
      return status;
    },

    async transactions(userId) { return store.listTransactions({ userId }); },
  };
}

export function registerFinanceCapabilities(naia, { service, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !userId) throw new Error('finance service and userId are required');
  const registered = [];
  registered.push(naia.registerCapability({
    name: 'finance.balances',
    tool: { risk: 'SENSITIVE', capability: 'finance.read', description: 'Reads normalized account balances', async run() { return service.balances(userId); } },
    rule: {
      name: 'finance-balances',
      match: ({ title }) => /quanto tenho|saldo/i.test(String(title ?? '')),
      action: () => ({ tool: 'finance.balances', input: {}, risk: 'SENSITIVE', requiresApproval: true }),
    },
  }));
  registered.push(naia.registerCapability({
    name: 'finance.spending',
    tool: { risk: 'SENSITIVE', capability: 'finance.read', description: 'Calculates deterministic spending from normalized transactions', async run(input) { return service.spending({ userId, ...input }); } },
    rule: {
      name: 'finance-spending',
      match: ({ title }) => /quanto gastei/i.test(String(title ?? '')),
      action: ({ title }) => {
        const categoryMatch = String(title ?? '').match(/em\s+([\p{L}\s]+?)\s+(?:este|nesse|no)\s+m[eê]s/iu);
        return { tool: 'finance.spending', input: { category: categoryMatch?.[1]?.trim() ?? null }, risk: 'SENSITIVE', requiresApproval: true };
      },
    },
  }));
  return registered;
}
