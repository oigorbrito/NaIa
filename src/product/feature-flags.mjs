import { createHash } from 'node:crypto';

function clone(v){return v==null?v:structuredClone(v);}
function normalizeId(v){return String(v??'').trim();}
function bucket(flagId,userId){const hex=createHash('sha256').update(`${flagId}:${userId}`).digest('hex').slice(0,8);return parseInt(hex,16)%10000;}

export function createMemoryFeatureFlagStore(initial=[]){
  const rows=new Map(initial.map((row)=>[row.id,clone(row)]));
  return {
    async save(row){rows.set(row.id,clone(row));return clone(row);},
    async get(id){const row=rows.get(String(id));return row?clone(row):null;},
    async list(){return [...rows.values()].map(clone);},
  };
}

export function normalizeFeatureFlag(input){
  const id=normalizeId(input?.id);if(!id)throw new Error('feature flag id is required');
  const percentage=Number(input?.percentage??100);if(!Number.isFinite(percentage)||percentage<0||percentage>100)throw new Error('feature flag percentage must be between 0 and 100');
  return {
    id,enabled:input?.enabled!==false,killSwitch:Boolean(input?.killSwitch),percentage,
    plans:[...new Set((input?.plans??[]).map(v=>String(v).toUpperCase()))],
    includeUsers:[...new Set((input?.includeUsers??[]).map(String))],
    excludeUsers:[...new Set((input?.excludeUsers??[]).map(String))],
    description:input?.description??null,updatedAt:input?.updatedAt??new Date().toISOString(),
  };
}

export function createFeatureFlagService({store=createMemoryFeatureFlagStore(),entitlements=null,now=()=>new Date().toISOString()}={}){
  return {
    async upsert(input){const flag=normalizeFeatureFlag({...input,updatedAt:now()});await store.save(flag);return clone(flag);},
    async setKillSwitch(id,value=true){const current=await store.get(id);if(!current)throw new Error('feature flag not found: '+id);current.killSwitch=Boolean(value);current.updatedAt=now();await store.save(current);return clone(current);},
    async evaluate({flagId,userId,planId=null}){
      const flag=await store.get(flagId);
      if(!flag)return {flagId,userId,enabled:false,reason:'FLAG_NOT_FOUND',bucket:null,planId};
      if(flag.killSwitch)return {flagId,userId,enabled:false,reason:'KILL_SWITCH',bucket:null,planId};
      if(!flag.enabled)return {flagId,userId,enabled:false,reason:'FLAG_DISABLED',bucket:null,planId};
      let resolvedPlan=planId;
      if(!resolvedPlan&&entitlements?.resolve){resolvedPlan=(await entitlements.resolve(userId)).planId;}
      if(flag.excludeUsers.includes(String(userId)))return {flagId,userId,enabled:false,reason:'USER_EXCLUDED',bucket:null,planId:resolvedPlan};
      if(flag.includeUsers.includes(String(userId)))return {flagId,userId,enabled:true,reason:'USER_INCLUDED',bucket:null,planId:resolvedPlan};
      if(flag.plans.length&&(!resolvedPlan||!flag.plans.includes(String(resolvedPlan).toUpperCase())))return {flagId,userId,enabled:false,reason:'PLAN_NOT_TARGETED',bucket:null,planId:resolvedPlan};
      const b=bucket(flagId,userId);
      const threshold=Math.round(flag.percentage*100);
      return {flagId,userId,enabled:b<threshold,reason:b<threshold?'ROLLOUT_INCLUDED':'ROLLOUT_EXCLUDED',bucket:b,planId:resolvedPlan,percentage:flag.percentage};
    },
    async list(){return store.list();},
  };
}
