import { randomUUID } from 'node:crypto';

function clone(value){ return structuredClone(value); }
function nowMs(value){ return new Date(value).getTime(); }

export function createMemoryQuoteStore(){
  const requests=new Map();
  const responses=new Map();
  const outbound=new Set();
  return {
    async saveRequest(row){ requests.set(row.id,clone(row)); return clone(row); },
    async getRequest(id){ const row=requests.get(id); return row?clone(row):null; },
    async saveResponse(row){ responses.set(row.id,clone(row)); return clone(row); },
    async listResponses(requestId){ return [...responses.values()].filter((row)=>row.requestId===requestId).map(clone); },
    async recordOutbound(key){ if(outbound.has(key)) return false; outbound.add(key); return true; },
  };
}

export function createFixtureQuoteProvider({ name, response=null, fail=null }={}){
  if(!name) throw new Error('quote provider name is required');
  return {
    name,
    async requestQuote(input){
      if(fail){ const e=new Error(fail.message??'provider failed'); e.code=fail.code??'PROVIDER_ERROR'; e.retryable=Boolean(fail.retryable); throw e; }
      return typeof response==='function'?response(clone(input)):clone(response);
    },
  };
}

export function createQuoteService({ store=createMemoryQuoteStore(), providers=[], idFactory=randomUUID, now=()=>new Date().toISOString() }={}){
  const providerMap=new Map(providers.map((p)=>[p.name,p]));
  return {
    async create({ userId, requirements, constraints={}, expiresAt=null, providers:providerNames=null }){
      if(!userId) throw new Error('userId is required');
      const selected=providerNames??providers.map((p)=>p.name);
      const row={ id:idFactory(), userId, requirements:clone(requirements??{}), constraints:clone(constraints), expiresAt, providerStates:Object.fromEntries(selected.map((name)=>[name,{state:'PENDING',updatedAt:now()}])), createdAt:now(), updatedAt:now() };
      await store.saveRequest(row);
      return clone(row);
    },
    async collect(requestId){
      const request=await store.getRequest(requestId); if(!request) throw new Error('quote request not found: '+requestId);
      for(const [providerName,state] of Object.entries(request.providerStates)){
        if(['RESPONDED','EXPIRED'].includes(state.state)) continue;
        const provider=providerMap.get(providerName);
        if(!provider){ request.providerStates[providerName]={state:'FAILED',code:'PROVIDER_UNAVAILABLE',updatedAt:now()}; continue; }
        const outboundKey=request.id+':'+providerName;
        const first=await store.recordOutbound(outboundKey);
        if(!first && state.state==='RESPONDED') continue;
        try{
          const raw=await provider.requestQuote({ requestId:request.id, requirements:clone(request.requirements), constraints:clone(request.constraints) });
          if(!raw){ request.providerStates[providerName]={state:'PENDING',updatedAt:now()}; continue; }
          const response={
            id:request.id+':'+providerName+':'+String(raw.id??'response'), requestId:request.id, provider:providerName,
            price:raw.price==null?null:Number(raw.price), currency:raw.currency??'BRL', availability:raw.availability??null,
            inclusions:clone(raw.inclusions??[]), exclusions:clone(raw.exclusions??[]), validUntil:raw.validUntil??null,
            source:clone(raw.source??{provider:providerName}), receivedAt:now(),
          };
          await store.saveResponse(response);
          request.providerStates[providerName]={state:'RESPONDED',responseId:response.id,updatedAt:now()};
        }catch(error){
          request.providerStates[providerName]={state:'FAILED',code:error?.code??'PROVIDER_ERROR',retryable:Boolean(error?.retryable),updatedAt:now()};
        }
      }
      request.updatedAt=now(); await store.saveRequest(request);
      return {request:clone(request),responses:await store.listResponses(request.id)};
    },
    async expire(requestId,{at=now()}={}){
      const request=await store.getRequest(requestId); if(!request) throw new Error('quote request not found: '+requestId);
      if(request.expiresAt && nowMs(at)>=nowMs(request.expiresAt)){
        for(const [name,state] of Object.entries(request.providerStates)){ if(state.state==='PENDING') request.providerStates[name]={state:'EXPIRED',updatedAt:at}; }
        request.updatedAt=at; await store.saveRequest(request);
      }
      return clone(request);
    },
    async compare(requestId,{at=now()}={}){
      const request=await this.expire(requestId,{at});
      const responses=await store.listResponses(requestId);
      const normalized=responses.map((row)=>{
        const expired=row.validUntil?nowMs(at)>nowMs(row.validUntil):false;
        return {...row,expired,total:Number(row.price??0)};
      }).sort((a,b)=>{
        if(a.expired!==b.expired) return a.expired?1:-1;
        const avA=a.availability===false?1:0, avB=b.availability===false?1:0;
        return avA-avB || a.total-b.total || a.provider.localeCompare(b.provider);
      });
      return { request, responses:normalized, selectable:normalized.filter((row)=>!row.expired&&row.availability!==false) };
    },
  };
}
