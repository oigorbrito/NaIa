import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

async function readQuoteJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {requests:{},responses:{},outbound:{}};throw error;}}
async function writeQuoteJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileQuoteStore({rootDir='.naia'}={}){
  const path=join(rootDir,'quotes.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readQuoteJson(path);const result=await fn(data);await writeQuoteJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async saveRequest(row){return mutate(data=>{data.requests[row.id]=clone(row);return row;});},
    async getRequest(id){const data=await readQuoteJson(path);return data.requests?.[String(id)]?clone(data.requests[String(id)]):null;},
    async saveResponse(row){return mutate(data=>{data.responses[row.id]=clone(row);return row;});},
    async listResponses(requestId){const data=await readQuoteJson(path);return Object.values(data.responses??{}).filter(row=>row.requestId===requestId).map(clone);},
    async recordOutbound(key){return mutate(data=>{if(data.outbound[key])return false;data.outbound[key]=true;return true;});},
  };
}

export function createFixtureQuoteProvider({ name, response=null, fail=null, contactRisk='READ_ONLY' }={}){
  if(!name) throw new Error('quote provider name is required');
  const calls=new Map();
  return {
    name, contactRisk:String(contactRisk).toUpperCase(),
    async requestQuote(input){
      const key=String(input?.idempotencyKey??'');
      if(key && calls.has(key)) return clone(calls.get(key));
      if(fail){ const e=new Error(fail.message??'provider failed'); e.code=fail.code??'PROVIDER_ERROR'; e.retryable=Boolean(fail.retryable); throw e; }
      const result=typeof response==='function'?await response(clone(input)):clone(response);
      if(key) calls.set(key,clone(result));
      return result;
    },
    callCount(){ return calls.size; },
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
        if(String(provider.contactRisk??'READ_ONLY').toUpperCase()!=='READ_ONLY'){
          request.providerStates[providerName]={state:'AWAITING_APPROVAL',risk:String(provider.contactRisk).toUpperCase(),updatedAt:now()};
          continue;
        }
        const outboundKey=request.id+':'+providerName;
        const first=await store.recordOutbound(outboundKey);
        if(!first && state.state==='RESPONDED') continue;
        try{
          const raw=await provider.requestQuote({ requestId:request.id, requirements:clone(request.requirements), constraints:clone(request.constraints), idempotencyKey:outboundKey });
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
    async collectProviderApproved(requestId,providerName){
      const request=await store.getRequest(requestId);if(!request)throw new Error('quote request not found: '+requestId);
      const provider=providerMap.get(providerName);if(!provider)throw new Error('quote provider not registered: '+providerName);
      const state=request.providerStates[providerName];if(!state)throw new Error('quote provider not part of request: '+providerName);
      const outboundKey=request.id+':'+providerName;
      const first=await store.recordOutbound(outboundKey);
      if(!first){return {request:clone(request),responses:await store.listResponses(request.id),duplicate:true};}
      try{
        const raw=await provider.requestQuote({requestId:request.id,requirements:clone(request.requirements),constraints:clone(request.constraints),idempotencyKey:outboundKey});
        if(!raw){request.providerStates[providerName]={state:'PENDING',updatedAt:now()};await store.saveRequest(request);return {request:clone(request),responses:await store.listResponses(request.id),duplicate:false};}
        const response={id:request.id+':'+providerName+':'+String(raw.id??'response'),requestId:request.id,provider:providerName,price:raw.price==null?null:Number(raw.price),currency:raw.currency??'BRL',availability:raw.availability??null,inclusions:clone(raw.inclusions??[]),exclusions:clone(raw.exclusions??[]),validUntil:raw.validUntil??null,source:clone(raw.source??{provider:providerName}),receivedAt:now()};
        await store.saveResponse(response);request.providerStates[providerName]={state:'RESPONDED',responseId:response.id,updatedAt:now()};request.updatedAt=now();await store.saveRequest(request);
        return {request:clone(request),responses:await store.listResponses(request.id),duplicate:false};
      }catch(error){request.providerStates[providerName]={state:'FAILED',code:error?.code??'PROVIDER_ERROR',retryable:Boolean(error?.retryable),updatedAt:now()};request.updatedAt=now();await store.saveRequest(request);throw error;}
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

export function registerQuoteCapabilities(naia,{service}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service)throw new Error('quote service is required');
  return naia.registerCapability({
    name:'quote.contact',
    tool:{risk:'EXTERNAL_WRITE',capability:'quotes.contact',description:'Contacts one selected quote provider after approval',async run(input){return service.collectProviderApproved(input.requestId,input.providerName);}},
  });
}

export async function proposeQuoteContact(naia,{requestId,providerName}){
  if(!naia||typeof naia.pursueAction!=='function')throw new Error('NaIA pursueAction is required');
  return naia.pursueAction({
    id:`quote-contact:${requestId}:${providerName}`,title:`Request quote from ${providerName}`,intent:'QUOTE_PROVIDER_CONTACT',
    action:{tool:'quote.contact',input:{requestId,providerName},risk:'EXTERNAL_WRITE',requiresApproval:true},
  });
}
