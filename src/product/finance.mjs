import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CONSENT_STATES = new Set(['ACTIVE', 'EXPIRED', 'REVOKED']);
const TX_STATUSES = new Set(['PENDING', 'POSTED']);

function clone(value) { return structuredClone(value); }
function normalizeProvider(value) { return String(value ?? '').trim().toLowerCase(); }
function normalizeCurrency(value) { return String(value ?? 'BRL').trim().toUpperCase(); }
function round(value, digits = 2) { return Number(Number(value ?? 0).toFixed(digits)); }
function monthKey(iso) { return String(iso).slice(0, 7); }
function previousMonthKey(month) {
  const match=String(month??'').match(/^(\d{4})-(\d{2})$/);
  if(!match) throw new Error('month must use YYYY-MM');
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-2,1));
  return date.toISOString().slice(0,7);
}
function normalizedMerchantKey(tx) {
  return String(tx.merchant ?? tx.description ?? '').trim().toLowerCase().replace(/\s+/g,' ');
}

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

async function readFinanceJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {connections:{},accounts:{},transactions:{},providerIndex:{},budgets:{}};throw error;}}
async function writeFinanceJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileFinanceStore({rootDir='.naia'}={}){
  const path=join(rootDir,'finance.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readFinanceJson(path);const result=await fn(data);await writeFinanceJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async saveConnection(connection){return mutate(data=>{data.connections[connection.id]=clone(connection);return connection;});},
    async getConnection(id){const data=await readFinanceJson(path);return data.connections?.[String(id)]?clone(data.connections[String(id)]):null;},
    async saveAccount(account){return mutate(data=>{data.accounts[account.id]=clone(account);return account;});},
    async listAccounts({userId}={}){const data=await readFinanceJson(path);return Object.values(data.accounts??{}).filter(row=>!userId||row.userId===userId).map(clone);},
    async saveTransaction(transaction){return mutate(data=>{data.transactions[transaction.id]=clone(transaction);data.providerIndex[`${transaction.userId}:${transaction.provider}:${transaction.providerTransactionId}`]=transaction.id;return transaction;});},
    async findTransactionByProviderId(userId,provider,providerTransactionId){const data=await readFinanceJson(path);const id=data.providerIndex?.[`${userId}:${normalizeProvider(provider)}:${providerTransactionId}`];return id&&data.transactions?.[id]?clone(data.transactions[id]):null;},
    async getTransaction(id){const data=await readFinanceJson(path);return data.transactions?.[String(id)]?clone(data.transactions[String(id)]):null;},
    async listTransactions({userId,from,to}={}){const data=await readFinanceJson(path);return Object.values(data.transactions??{}).filter(row=>{if(userId&&row.userId!==userId)return false;if(from&&row.bookedAt<from)return false;if(to&&row.bookedAt>to)return false;return true;}).map(clone);},
    async saveBudget(budget){return mutate(data=>{data.budgets[budget.id]=clone(budget);return budget;});},
    async listBudgets({userId,month}={}){const data=await readFinanceJson(path);return Object.values(data.budgets??{}).filter(row=>(!userId||row.userId===userId)&&(!month||row.month===month)).map(clone);},
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
      const wrapped = new Error('finance provider failed');
      wrapped.code = error?.code ?? 'PROVIDER_ERROR';
      wrapped.retryable = Boolean(error?.retryable);
      throw wrapped;
    }
    const connectionId = provider + ':' + userId;
    await store.saveConnection({ id: connectionId, userId, provider, consentState: snapshot.consentState, importedAt: now() });
    assertConsentActive(snapshot);

    const normalizedAccounts = [];
    for (const raw of snapshot.accounts ?? []) {
      const account = normalizeAccount({ userId, connectionId, provider, raw, balance: snapshot.balances?.[raw.id] });
      await store.saveAccount(account);
      normalizedAccounts.push(account);
    }

    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    for (const raw of snapshot.transactions ?? []) {
      const existing = await store.findTransactionByProviderId(userId, provider, raw.id);
      if (existing) {
        const incoming = normalizeTransaction({ userId, connectionId, provider, raw, idFactory: () => existing.id });
        const refreshed = { ...incoming, id: existing.id, userCategoryOverride: existing.userCategoryOverride ?? null };
        const changed = ['accountId','amount','currency','direction','bookedAt','merchant','description','status','providerCategory','inferredCategory','categoryConfidence'].some((key)=>JSON.stringify(existing[key]??null)!==JSON.stringify(refreshed[key]??null));
        if (changed) { await store.saveTransaction(refreshed); updated += 1; }
        else duplicates += 1;
        continue;
      }
      const transaction = normalizeTransaction({ userId, connectionId, provider, raw, idFactory });
      await store.saveTransaction(transaction);
      imported += 1;
    }

    return { provider, connectionId, accounts: normalizedAccounts, importedTransactions: imported, updatedTransactions: updated, duplicateTransactions: duplicates };
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

    async spendingChange({ userId, month = monthKey(now()), previousMonth = previousMonthKey(month), category = null }) {
      const current = await spendingByCategory({ userId, month, category });
      const previous = await spendingByCategory({ userId, month: previousMonth, category });
      const delta = round(current - previous);
      const percent = previous === 0 ? null : round((delta / previous) * 100, 2);
      return {
        category, currentMonth: month, previousMonth, current, previous, delta, percent,
        interpretation: previous === 0 ? 'NO_PREVIOUS_BASELINE' : (delta > 0 ? 'INCREASE' : delta < 0 ? 'DECREASE' : 'UNCHANGED'),
      };
    },

    async recurringExpenses({ userId, minOccurrences = 2, minGapDays = 20, maxGapDays = 45 } = {}) {
      const rows=(await store.listTransactions({ userId }))
        .filter((tx)=>tx.status==='POSTED'&&tx.direction==='OUTFLOW'&&normalizedMerchantKey(tx))
        .sort((a,b)=>String(a.bookedAt).localeCompare(String(b.bookedAt)));
      const groups=new Map();
      for(const tx of rows){
        const category=String(tx.userCategoryOverride ?? tx.inferredCategory ?? tx.providerCategory ?? 'uncategorized').toLowerCase();
        const key=[normalizedMerchantKey(tx),tx.currency,category].join('|');
        if(!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(tx);
      }
      const results=[];
      for(const txs of groups.values()){
        if(txs.length<Number(minOccurrences)) continue;
        const gaps=[];
        for(let i=1;i<txs.length;i++){
          const gap=(new Date(txs[i].bookedAt).getTime()-new Date(txs[i-1].bookedAt).getTime())/86400000;
          if(Number.isFinite(gap)) gaps.push(gap);
        }
        if(!gaps.length) continue;
        const qualifying=gaps.filter((gap)=>gap>=Number(minGapDays)&&gap<=Number(maxGapDays));
        if(qualifying.length!==gaps.length) continue;
        const amounts=txs.map((tx)=>Math.abs(tx.amount));
        const mean=amounts.reduce((sum,value)=>sum+value,0)/amounts.length;
        const maxDeviation=mean===0?0:Math.max(...amounts.map((value)=>Math.abs(value-mean)/mean));
        const confidence=maxDeviation<=0.05?'HIGH':maxDeviation<=0.2?'MEDIUM':'LOW';
        results.push({
          merchant: txs[0].merchant ?? txs[0].description,
          category: txs[0].userCategoryOverride ?? txs[0].inferredCategory ?? txs[0].providerCategory ?? 'uncategorized',
          currency: txs[0].currency,
          occurrences: txs.length,
          averageAmount: round(mean),
          lastAmount: round(Math.abs(txs.at(-1).amount)),
          firstObservedAt: txs[0].bookedAt,
          lastObservedAt: txs.at(-1).bookedAt,
          typicalGapDays: round(gaps.reduce((sum,value)=>sum+value,0)/gaps.length,1),
          confidence,
          evidenceTransactionIds: txs.map((tx)=>tx.id),
          factType: 'INFERRED_RECURRING_PATTERN',
        });
      }
      return results.sort((a,b)=>b.occurrences-a.occurrences||b.averageAmount-a.averageAmount||String(a.merchant).localeCompare(String(b.merchant)));
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
  registered.push(naia.registerCapability({
    name: 'finance.spendingChange',
    tool: { risk: 'SENSITIVE', capability: 'finance.read', description: 'Compares observed spending between two months', async run(input) { return service.spendingChange({ userId, ...input }); } },
    rule: {
      name: 'finance-spending-change',
      match: ({ title }) => /gasto\s+(?:aumentou|diminuiu)|compar(?:e|ar).*gasto|m[eê]s\s+passado/i.test(String(title ?? '')),
      action: () => ({ tool: 'finance.spendingChange', input: {}, risk: 'SENSITIVE', requiresApproval: true }),
    },
  }));
  registered.push(naia.registerCapability({
    name: 'finance.recurring',
    tool: { risk: 'SENSITIVE', capability: 'finance.read', description: 'Finds evidence-grounded recurring expense patterns', async run(input) { return service.recurringExpenses({ userId, ...input }); } },
    rule: {
      name: 'finance-recurring',
      match: ({ title }) => /gastos?\s+recorrentes?|assinaturas?|despesas?\s+recorrentes?/i.test(String(title ?? '')),
      action: () => ({ tool: 'finance.recurring', input: {}, risk: 'SENSITIVE', requiresApproval: true }),
    },
  }));
  return registered;
}
