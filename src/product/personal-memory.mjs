import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TYPES=new Set(['PREFERENCE','PERSON','PLACE','FACT']);
const SENSITIVITY=new Set(['NORMAL','SENSITIVE']);
const FORBIDDEN_KEYS=/password|token|secret|api[_-]?key|credential/i;

function clone(v){return v==null?v:structuredClone(v);}
function normalizeText(v){return String(v??'').trim();}
function assertNoSecrets(value,path='value'){
  if(Array.isArray(value)){value.forEach((item,i)=>assertNoSecrets(item,`${path}[${i}]`));return;}
  if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){if(FORBIDDEN_KEYS.test(key)){const e=new Error(`personal memory cannot store credential-like field: ${path}.${key}`);e.code='FORBIDDEN_MEMORY_FIELD';throw e;}assertNoSecrets(item,`${path}.${key}`);}
  }
}
function normalizeRecord(input,{id=randomUUID(),now=new Date().toISOString()}={}){
  const userId=normalizeText(input?.userId);if(!userId)throw new Error('userId is required');
  const type=normalizeText(input?.type).toUpperCase();if(!TYPES.has(type))throw new Error(`unsupported memory type: ${type}`);
  const key=normalizeText(input?.key);if(!key)throw new Error('memory key is required');
  const sensitivity=normalizeText(input?.sensitivity||'NORMAL').toUpperCase();if(!SENSITIVITY.has(sensitivity))throw new Error(`unsupported sensitivity: ${sensitivity}`);
  const sourceKind=normalizeText(input?.source?.kind).toUpperCase();if(!['EXPLICIT_USER','CONNECTED_SOURCE'].includes(sourceKind))throw new Error('memory provenance source.kind is required');
  const value=clone(input?.value);assertNoSecrets(value);
  if(sensitivity==='SENSITIVE'&&(sourceKind!=='EXPLICIT_USER'||input?.explicitConsent!==true)){const e=new Error('sensitive memory requires explicit user source and consent');e.code='SENSITIVE_MEMORY_CONSENT_REQUIRED';throw e;}
  return {id:String(id),userId,type,key,value,attributes:clone(input?.attributes??{}),aliases:[...new Set((input?.aliases??[]).map(normalizeText).filter(Boolean))],sensitivity,source:{kind:sourceKind,reference:input?.source?.reference??null},createdAt:input?.createdAt??now,updatedAt:now};
}

export function createMemoryPersonalMemoryStore(){
  const rows=new Map();
  return {
    async save(record){rows.set(record.id,clone(record));return clone(record);},
    async get(id){const row=rows.get(String(id));return row?clone(row):null;},
    async list(userId){return [...rows.values()].filter(r=>r.userId===userId).map(clone);},
    async delete(id){return rows.delete(String(id));},
  };
}

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {};throw error;}}
async function writeAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFilePersonalMemoryStore({rootDir='.naia'}={}){
  const path=join(rootDir,'personal-memory.json');let chain=Promise.resolve();
  return {
    path,
    async save(record){chain=chain.catch(()=>{}).then(async()=>{const all=await readJson(path);all[record.id]=clone(record);await writeAtomic(path,all);return clone(record);});return chain;},
    async get(id){const all=await readJson(path);return all[id]?clone(all[id]):null;},
    async list(userId){const all=await readJson(path);return Object.values(all).filter(r=>r.userId===userId).map(clone);},
    async delete(id){chain=chain.catch(()=>{}).then(async()=>{const all=await readJson(path);const existed=Object.prototype.hasOwnProperty.call(all,id);delete all[id];await writeAtomic(path,all);return existed;});return chain;},
  };
}

function scoreRecord(record,query){
  const q=normalizeText(query).toLowerCase();if(!q)return 0;
  const hay=[record.key,...record.aliases,JSON.stringify(record.value),JSON.stringify(record.attributes)].join(' ').toLowerCase();
  if(hay===q)return 100;if(record.key.toLowerCase()===q)return 90;if(record.aliases.some(a=>a.toLowerCase()===q))return 80;
  const tokens=q.split(/\s+/).filter(Boolean);return tokens.reduce((score,t)=>score+(hay.includes(t)?10:0),0);
}

export function createPersonalMemoryService({store=createMemoryPersonalMemoryStore(),idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  return {
    async put(input){
      const existing=input?.id?await store.get(input.id):null;
      if(existing&&existing.userId!==input.userId)throw new Error('memory user mismatch');
      const record=normalizeRecord(input,{id:existing?.id??idFactory(),now:now()});
      if(existing)record.createdAt=existing.createdAt;
      await store.save(record);return clone(record);
    },
    async get({userId,id}){const row=await store.get(id);return row&&row.userId===userId?clone(row):null;},
    async getByKey({userId,type=null,key}){const rows=await store.list(userId);return rows.find(r=>(!type||r.type===String(type).toUpperCase())&&r.key===String(key))??null;},
    async search({userId,query='',type=null,attributes={}}){
      const rows=await store.list(userId);
      return rows.filter(r=>(!type||r.type===String(type).toUpperCase())&&Object.entries(attributes).every(([k,v])=>r.attributes?.[k]===v)).map(r=>({...clone(r),score:scoreRecord(r,query)})).filter(r=>!query||r.score>0).sort((a,b)=>b.score-a.score||String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async delete({userId,id,confirmSensitive=false}){
      const row=await store.get(id);if(!row||row.userId!==userId)return {deleted:false};
      if(row.sensitivity==='SENSITIVE'&&!confirmSensitive){const e=new Error('sensitive memory deletion requires explicit confirmation');e.code='SENSITIVE_MEMORY_DELETE_CONFIRMATION_REQUIRED';throw e;}
      return {deleted:await store.delete(id),id};
    },
    async list(userId){return store.list(userId);},
  };
}

export function registerPersonalMemoryCapabilities(naia,{service,userId}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service||!userId)throw new Error('memory service and userId are required');
  return [
    naia.registerCapability({name:'memory.search',tool:{risk:'SENSITIVE',capability:'memory.read',description:'Searches explicit personal memory',async run(input){return service.search({userId,...input});}}}),
    naia.registerCapability({name:'memory.put',tool:{risk:'LOCAL_WRITE',capability:'memory.write',description:'Stores explicit personal memory',async run(input){return service.put({userId,...input});}}}),
    naia.registerCapability({name:'memory.delete',tool:{risk:'LOCAL_WRITE',capability:'memory.write',description:'Deletes personal memory',async run(input){return service.delete({userId,...input});}}}),
  ];
}
