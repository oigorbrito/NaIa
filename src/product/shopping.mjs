import { createHash, randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }
function fp(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function normalizeShoppingItems(items = []) {
  return items.map((item, index) => {
    const name = String(item?.name ?? '').trim();
    if (!name) throw new Error('shopping item name is required at index ' + index);
    const quantity = Number(item?.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('shopping item quantity must be positive');
    return {
      key: item.key ?? 'item-' + (index + 1),
      name,
      quantity,
      unit: item.unit ?? 'unit',
      substitutionsAllowed: item.substitutionsAllowed !== false,
      constraints: clone(item.constraints ?? {}),
    };
  });
}

export function createFixtureShoppingProvider({ name, quoteRevision = '1', catalog = {}, fee = 0 } = {}) {
  if (!name) throw new Error('shopping provider name is required');
  let revision = String(quoteRevision);
  const orders = new Map();
  return {
    name,
    async quote({ items }) {
      const rows = items.map((item) => {
        const entry = catalog[item.name];
        if (!entry) return { key: item.key, requestedName: item.name, available: false, quantity: item.quantity };
        const substitute = entry.substitute ?? null;
        const fulfilledName = substitute ?? item.name;
        const unitPrice = Number(entry.unitPrice ?? 0);
        return {
          key: item.key, requestedName: item.name, fulfilledName, quantity: item.quantity, unitPrice,
          available: entry.available !== false, substitution: substitute ? { from: item.name, to: substitute } : null,
        };
      });
      return { provider: name, revision, fee: Number(fee), items: rows };
    },
    async placeOrder({ cart, expectedRevision, idempotencyKey }) {
      if (orders.has(idempotencyKey)) return clone(orders.get(idempotencyKey));
      if (String(expectedRevision) !== revision) { const e = new Error('quote changed'); e.code = 'QUOTE_CHANGED'; e.currentRevision = revision; throw e; }
      const result = { providerOrderId: name + '-order-' + (orders.size + 1), provider: name, total: cart.total, items: clone(cart.items), revision };
      orders.set(idempotencyKey, result);
      return clone(result);
    },
    setRevision(value) { revision = String(value); },
    orders() { return [...orders.values()].map(clone); },
  };
}

function quoteTotals(quote) {
  const itemTotal = quote.items.reduce((sum, row) => row.available ? sum + Number(row.unitPrice ?? 0) * Number(row.quantity ?? 0) : sum, 0);
  return Number((itemTotal + Number(quote.fee ?? 0)).toFixed(2));
}

export function buildShoppingProposal(quotes, { strategy = 'SINGLE_STORE' } = {}) {
  if (!['SINGLE_STORE', 'SPLIT_BASKET'].includes(strategy)) throw new Error('unsupported shopping strategy');
  const normalized = quotes.map((quote) => ({ ...clone(quote), total: quoteTotals(quote) }));
  if (strategy === 'SINGLE_STORE') {
    const ranked = normalized.sort((a,b) => {
      const missingA = a.items.filter((row) => !row.available).length;
      const missingB = b.items.filter((row) => !row.available).length;
      return missingA - missingB || a.total - b.total || a.provider.localeCompare(b.provider);
    });
    const selected = ranked[0] ?? null;
    return { strategy, selected, alternatives: ranked.slice(1), executable: Boolean(selected) };
  }
  const keys = [...new Set(normalized.flatMap((q) => q.items.map((row) => row.key)))];
  const selectedItems = [];
  const providers = new Set();
  for (const key of keys) {
    const candidates = normalized.flatMap((quote) => quote.items.filter((row) => row.key === key && row.available).map((row) => ({ provider: quote.provider, revision: quote.revision, row })));
    candidates.sort((a,b) => Number(a.row.unitPrice ?? 0) - Number(b.row.unitPrice ?? 0) || a.provider.localeCompare(b.provider));
    if (candidates[0]) { selectedItems.push({ ...clone(candidates[0].row), provider: candidates[0].provider, revision: candidates[0].revision }); providers.add(candidates[0].provider); }
    else selectedItems.push({ key, available: false });
  }
  const fees = normalized.filter((q) => providers.has(q.provider)).reduce((sum,q) => sum + Number(q.fee ?? 0),0);
  const total = Number((selectedItems.reduce((sum,row)=>row.available ? sum + Number(row.unitPrice ?? 0)*Number(row.quantity ?? 0) : sum,0)+fees).toFixed(2));
  return { strategy, selected: { items: selectedItems, total, providers: [...providers] }, alternatives: [], executable: false, executionReason: 'MULTI_ORDER_REQUIRES_SEPARATE_APPROVALS' };
}

export function createMemoryShoppingStore() {
  const actions = new Map(); const commits = new Map();
  return {
    async saveAction(row){ actions.set(row.id,clone(row)); return clone(row); },
    async getAction(id){ const row=actions.get(id); return row?clone(row):null; },
    async saveCommit(key,row){ commits.set(key,clone(row)); return clone(row); },
    async getCommit(key){ const row=commits.get(key); return row?clone(row):null; },
  };
}

export function createShoppingService({ providers = [], store = createMemoryShoppingStore(), idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  const providerMap = new Map(providers.map((p)=>[p.name,p]));
  return {
    async quote({ items, strategy = 'SINGLE_STORE' }) {
      const normalizedItems = normalizeShoppingItems(items);
      const quotes = [];
      for (const provider of providers) quotes.push(await provider.quote({ items: clone(normalizedItems) }));
      return { items: normalizedItems, proposal: buildShoppingProposal(quotes,{strategy}) };
    },
    async prepareOrder({ userId, quoteResult }) {
      const proposal = quoteResult?.proposal;
      if (!proposal?.selected) throw new Error('shopping proposal is required');
      if (!proposal.executable) { const e = new Error('shopping proposal is not safely executable'); e.code = proposal.executionReason ?? 'NOT_EXECUTABLE'; throw e; }
      const selected = proposal.selected;
      const unavailable = selected.items.filter((row)=>!row.available);
      const substitutions = selected.items.filter((row)=>row.substitution);
      const payload = { userId, provider: selected.provider, revision: selected.revision, items: clone(selected.items), total: selected.total, unavailable, substitutions };
      const action = { id:idFactory(), userId, status:'WAITING_APPROVAL', fingerprint:fp(payload), payload, approvedAt:null, createdAt:now(), updatedAt:now() };
      await store.saveAction(action); return clone(action);
    },
    async approve(actionId, actionFingerprint) {
      const action=await store.getAction(actionId); if(!action) throw new Error('shopping action not found');
      if(action.fingerprint!==actionFingerprint){ const e=new Error('shopping approval mismatch'); e.code='APPROVAL_MISMATCH'; throw e; }
      action.status='APPROVED'; action.approvedAt=now(); action.updatedAt=now(); await store.saveAction(action); return clone(action);
    },
    async execute(actionId,{ fingerprint:approvedFingerprint,idempotencyKey }) {
      const action=await store.getAction(actionId); if(!action) throw new Error('shopping action not found');
      if(!idempotencyKey) throw new Error('idempotencyKey is required');
      const prior=await store.getCommit(idempotencyKey); if(prior) return {duplicate:true,...clone(prior)};
      if(action.status!=='APPROVED'||action.fingerprint!==approvedFingerprint){ const e=new Error('shopping order requires matching approval'); e.code='APPROVAL_REQUIRED'; throw e; }
      const provider=providerMap.get(action.payload.provider); if(!provider) throw new Error('shopping provider not registered');
      try {
        const result=await provider.placeOrder({ cart:clone(action.payload), expectedRevision:action.payload.revision, idempotencyKey });
        action.status='COMPLETED'; action.updatedAt=now(); await store.saveAction(action);
        const commit={ actionId, result:clone(result), committedAt:now() }; await store.saveCommit(idempotencyKey,commit); return {duplicate:false,...clone(commit)};
      } catch(error){
        if(error?.code==='QUOTE_CHANGED') { action.status='WAITING_REVIEW'; action.approvedAt=null; await store.saveAction(action); }
        throw error;
      }
    },
    async cancel(actionId){ const action=await store.getAction(actionId); if(!action) throw new Error('shopping action not found'); if(action.status!=='COMPLETED') action.status='CANCELLED'; action.updatedAt=now(); await store.saveAction(action); return clone(action); },
    async getAction(id){ return store.getAction(id); },
  };
}
