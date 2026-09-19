import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

function clone(v){return v==null?v:structuredClone(v);}

export function createMemoryImageGenerationStore(){
  const rows=new Map();const logicalIndex=new Map();
  return {
    async save(row){rows.set(row.id,clone(row));logicalIndex.set(`${row.userId}:${row.logicalId}`,row.id);return clone(row);},
    async get(id){const row=rows.get(String(id));return row?clone(row):null;},
    async findByLogicalId(userId,logicalId){const id=logicalIndex.get(`${userId}:${logicalId}`);return id?clone(rows.get(id)):null;},
    async list(userId){return [...rows.values()].filter(r=>r.userId===userId).map(clone);},
  };
}

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {rows:{},logicalIndex:{}};throw error;}}
async function writeAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileImageGenerationStore({rootDir='.naia'}={}){
  const path=join(rootDir,'image-generations.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readJson(path);const result=await fn(data);await writeAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async save(row){return mutate(data=>{data.rows[row.id]=clone(row);data.logicalIndex[`${row.userId}:${row.logicalId}`]=row.id;return row;});},
    async get(id){const data=await readJson(path);return data.rows?.[String(id)]?clone(data.rows[String(id)]):null;},
    async findByLogicalId(userId,logicalId){const data=await readJson(path);const id=data.logicalIndex?.[`${userId}:${logicalId}`];return id&&data.rows?.[id]?clone(data.rows[id]):null;},
    async list(userId){const data=await readJson(path);return Object.values(data.rows??{}).filter(r=>r.userId===userId).map(clone);},
  };
}

export function createFixtureImageProvider({name='fixture-image',fail=null,secret='provider-secret',generate=null}={}){
  return {
    name,secret,
    async generate(input){
      if(fail){const error=new Error(fail.message??'image provider failed');error.code=fail.code??'PROVIDER_FAILED';error.retryable=Boolean(fail.retryable);throw error;}
      if(typeof generate==='function')return generate(clone(input));
      return {providerGenerationId:`gen-${input.idempotencyKey}`,model:'fixture-image-model',assets:[{id:'asset-1',url:'https://example.invalid/generated.png',mimeType:'image/png'}],usage:{images:1}};
    },
  };
}

export function createImageGenerationService({store=createMemoryImageGenerationStore(),provider,entitlements,meter=null,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!provider||typeof provider.generate!=='function')throw new Error('image provider is required');
  if(!entitlements||typeof entitlements.can!=='function'||typeof entitlements.attribute!=='function')throw new Error('entitlement service is required');
  async function policy(userId){
    const access=await entitlements.can(userId,'image.generate');if(!access.allowed){const e=new Error('image generation not entitled');e.code='NOT_ENTITLED';throw e;}
    const [quality,watermark]=await Promise.all([entitlements.attribute(userId,'imageQuality'),entitlements.attribute(userId,'imageWatermark')]);
    return {planId:access.planId,quality:quality.value??'standard',watermark:Boolean(watermark.value)};
  }
  return {
    async generate({userId,logicalId,prompt,width=null,height=null,metadata={}}){
      if(!userId||!logicalId||!String(prompt??'').trim())throw new Error('userId, logicalId and prompt are required');
      const existing=await store.findByLogicalId(userId,logicalId);
      if(existing)return {generation:existing,duplicate:true};
      const resolved=await policy(userId);
      if(meter?.inspect){const usage=await meter.inspect({userId,metric:'imageGenerations.monthly',window:'MONTH'});if(usage.limit!=null&&usage.used+1>usage.limit){const e=new Error('image generation limit reached');e.code='LIMIT_REACHED';e.usage=usage;throw e;}}
      const row={id:idFactory(),userId,logicalId,prompt:String(prompt).trim(),quality:resolved.quality,watermark:resolved.watermark,planId:resolved.planId,status:'PENDING',provider:provider.name??'unknown',providerGenerationId:null,model:null,assets:[],usage:null,error:null,metadata:clone(metadata),createdAt:now(),updatedAt:now()};
      await store.save(row);
      try{
        const result=await provider.generate({prompt:row.prompt,quality:row.quality,watermark:row.watermark,width,height,idempotencyKey:`naia-image:${userId}:${logicalId}`});
        row.status='COMPLETED';row.providerGenerationId=result?.providerGenerationId??null;row.model=result?.model??null;row.assets=clone(result?.assets??[]);row.usage=clone(result?.usage??null);row.updatedAt=now();
        await store.save(row);
        if(meter?.consume)row.metering=await meter.consume({userId,metric:'imageGenerations.monthly',window:'MONTH',logicalId:`image:${logicalId}`});
        return {generation:clone(row),duplicate:false};
      }catch(error){
        row.status='FAILED';row.error={code:error?.code??'PROVIDER_FAILED',retryable:Boolean(error?.retryable)};row.updatedAt=now();await store.save(row);throw error;
      }
    },
    async get({userId,id}){const row=await store.get(id);return row&&row.userId===userId?row:null;},
    async list(userId){return store.list(userId);},
  };
}

export function registerImageGenerationCapability(naia,{service,userId}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service||!userId)throw new Error('image generation service and userId are required');
  return naia.registerCapability({
    name:'image.generate',
    tool:{risk:'SENSITIVE',capability:'image.generate',description:'Generates an image through the configured provider under plan policy',async run(input){return service.generate({userId,...input});}},
  });
}
