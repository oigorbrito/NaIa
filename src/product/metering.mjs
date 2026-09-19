import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
function clone(value) { return structuredClone(value); }

function dayKey(date) { return date.toISOString().slice(0, 10); }
function monthKey(date) { return date.toISOString().slice(0, 7); }

function windowKey(window, at) {
  if (window === 'DAY') return dayKey(at);
  if (window === 'MONTH') return monthKey(at);
  if (window === 'ACTIVE') return 'ACTIVE';
  throw new Error('unsupported metering window: ' + window);
}

export function createMemoryUsageStore() {
  const counters = new Map();
  const operations = new Map();
  return {
    async consumeAtomic({ counterKey, operationKey, amount, limit = null }) {
      if (operations.has(operationKey)) return { duplicate: true, limited: false, used: counters.get(counterKey) ?? 0 };
      const current = counters.get(counterKey) ?? 0;
      const next = current + amount;
      if (limit != null && next > limit) return { duplicate: false, limited: true, used: current };
      counters.set(counterKey, next);
      operations.set(operationKey, { counterKey, amount });
      return { duplicate: false, limited: false, used: next };
    },
    async get(counterKey) { return counters.get(counterKey) ?? 0; },
    async releaseAtomic({ counterKey, operationKey, amount }) {
      if (operations.has(operationKey)) return { duplicate: true, used: counters.get(counterKey) ?? 0 };
      const next = Math.max(0, (counters.get(counterKey) ?? 0) - amount);
      counters.set(counterKey, next);
      operations.set(operationKey, { counterKey, amount: -amount });
      return { duplicate: false, used: next };
    },
  };
}

async function readUsageJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {counters:{},operations:{}};throw error;}}
async function writeUsageJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileUsageStore({rootDir='.naia'}={}){
  const path=join(rootDir,'usage-meter.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readUsageJson(path);const result=await fn(data);await writeUsageJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async consumeAtomic({counterKey,operationKey,amount,limit=null}){
      return mutate(data=>{if(data.operations[operationKey])return {duplicate:true,limited:false,used:Number(data.counters[counterKey]??0)};const current=Number(data.counters[counterKey]??0);const next=current+amount;if(limit!=null&&next>limit)return {duplicate:false,limited:true,used:current};data.counters[counterKey]=next;data.operations[operationKey]={counterKey,amount};return {duplicate:false,limited:false,used:next};});
    },
    async get(counterKey){const data=await readUsageJson(path);return Number(data.counters?.[counterKey]??0);},
    async releaseAtomic({counterKey,operationKey,amount}){
      return mutate(data=>{if(data.operations[operationKey])return {duplicate:true,used:Number(data.counters[counterKey]??0)};const next=Math.max(0,Number(data.counters[counterKey]??0)-amount);data.counters[counterKey]=next;data.operations[operationKey]={counterKey,amount:-amount};return {duplicate:false,used:next};});
    },
  };
}

export function createUsageMeter({ store = createMemoryUsageStore(), entitlements, now = () => new Date() } = {}) {
  if (!entitlements || typeof entitlements.limit !== 'function') throw new Error('entitlement service is required');

  async function inspect({ userId, metric, window }) {
    const at = now();
    const key = windowKey(window, at);
    const counterKey = [userId, metric, key].join(':');
    const limit = await entitlements.limit(userId, metric);
    const used = await store.get(counterKey);
    return { userId, metric, window, windowKey: key, used, limit: limit.value, remaining: limit.value == null ? null : Math.max(0, limit.value - used), planId: limit.planId };
  }

  return {
    inspect,

    async consume({ userId, metric, window, amount = 1, logicalId }) {
      if (!userId || !metric || !logicalId) throw new Error('userId, metric and logicalId are required');
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('amount must be positive');
      const before = await inspect({ userId, metric, window });
      const counterKey = [userId, metric, before.windowKey].join(':');
      const operationKey = ['consume', userId, metric, before.windowKey, logicalId].join(':');
      const consumed = await store.consumeAtomic({ counterKey, operationKey, amount: numericAmount, limit: before.limit });
      const after = await inspect({ userId, metric, window });
      if (consumed.limited) return { ok: false, code: 'LIMIT_REACHED', duplicate: false, ...after };
      return { ok: true, code: consumed.duplicate ? 'ALREADY_COUNTED' : 'COUNTED', duplicate: consumed.duplicate, ...after };
    },

    async releaseActive({ userId, metric, logicalId, amount = 1 }) {
      const before = await inspect({ userId, metric, window: 'ACTIVE' });
      const counterKey = [userId, metric, before.windowKey].join(':');
      const operationKey = ['release', userId, metric, before.windowKey, logicalId].join(':');
      const released = await store.releaseAtomic({ counterKey, operationKey, amount: Number(amount) });
      const after = await inspect({ userId, metric, window: 'ACTIVE' });
      return { ok: true, duplicate: released.duplicate, ...after };
    },
  };
}

export function createQuotaPolicy({ entitlements, meter } = {}) {
  if (!entitlements || !meter) throw new Error('entitlements and meter are required');
  return {
    async authorize({ userId, capability, usage = null }) {
      const entitlement = await entitlements.can(userId, capability);
      if (!entitlement.allowed) return { allowed: false, reason: 'NOT_ENTITLED', entitlement };
      if (!usage) return { allowed: true, reason: 'ENTITLED', entitlement };
      const snapshot = await meter.inspect({ userId, metric: usage.metric, window: usage.window });
      if (snapshot.limit != null && snapshot.used + (usage.amount ?? 1) > snapshot.limit) {
        return { allowed: false, reason: 'LIMIT_REACHED', entitlement, usage: snapshot };
      }
      return { allowed: true, reason: 'ENTITLED_WITH_QUOTA', entitlement, usage: snapshot };
    },
  };
}
