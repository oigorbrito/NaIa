import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){return v==null?v:structuredClone(v);}
const STATES=new Set(['BACKED_UP','NOT_BACKED_UP','UNKNOWN','PROVIDER_UNAVAILABLE']);

export function createMemoryMediaBackupStore(){
  const rows=new Map();
  return {
    async save(itemId,row){rows.set(String(itemId),clone(row));return clone(row);},
    async get(itemId){const row=rows.get(String(itemId));return row?clone(row):null;},
  };
}

async function readBackupJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {rows:{}};throw error;}}
async function writeBackupJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileMediaBackupStore({rootDir='.naia'}={}){
  const path=join(rootDir,'media-backup-state.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readBackupJson(path);const result=await fn(data);await writeBackupJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async save(itemId,row){return mutate(data=>{data.rows[String(itemId)]=clone(row);return row;});},
    async get(itemId){const data=await readBackupJson(path);return data.rows?.[String(itemId)]?clone(data.rows[String(itemId)]):null;},
  };
}

export function createFixtureMediaBackupProvider({name='fixture-backup',states={},fail=null}={}){
  return {
    name,
    async lookup(items){
      if(fail){const e=new Error(fail.message??'backup provider unavailable');e.code=fail.code??'PROVIDER_UNAVAILABLE';e.retryable=Boolean(fail.retryable);throw e;}
      return items.map(item=>({itemId:String(item.id),state:String(states[item.id]??'UNKNOWN').toUpperCase()}));
    },
  };
}

export function createMediaBackupService({provider,store=createMemoryMediaBackupStore(),now=()=>new Date().toISOString()}={}){
  if(!provider||typeof provider.lookup!=='function')throw new Error('media backup provider is required');
  return {
    async refresh(items=[]){
      let results;
      try{results=await provider.lookup(clone(items));}
      catch(error){
        results=items.map(item=>({itemId:String(item.id),state:'PROVIDER_UNAVAILABLE',errorCode:error?.code??'PROVIDER_UNAVAILABLE'}));
      }
      const byId=new Map((results??[]).map(row=>[String(row.itemId),row]));const saved=[];
      for(const item of items){
        const raw=byId.get(String(item.id))??{state:'UNKNOWN'};
        const state=String(raw.state??'UNKNOWN').toUpperCase();
        const normalized=STATES.has(state)?state:'UNKNOWN';
        const row={itemId:String(item.id),state:normalized,provider:provider.name??'unknown',observedAt:now(),errorCode:raw.errorCode??null};
        await store.save(item.id,row);saved.push(row);
      }
      return clone(saved);
    },
    async state(itemId,{maxAgeMs=null,asOf=now()}={}){
      const row=await store.get(itemId);
      if(!row)return {itemId:String(itemId),state:'UNKNOWN',provider:null,observedAt:null,stale:false};
      const age=new Date(asOf).getTime()-new Date(row.observedAt).getTime();
      const stale=Number.isFinite(Number(maxAgeMs))&&age>Number(maxAgeMs);
      if(stale)return {...clone(row),state:'UNKNOWN',stale:true,previousState:row.state};
      return {...clone(row),stale:false};
    },
  };
}

export function createBackupAwareCleanupPolicy({backupService,requireBackedUp=true,maxAgeMs=24*60*60*1000}={}){
  if(!backupService||typeof backupService.state!=='function')throw new Error('backup service is required');
  return {
    async validate({items}){
      if(!requireBackedUp)return {allowed:true,reasons:[]};
      const reasons=[];
      for(const item of items){
        const state=await backupService.state(item.id,{maxAgeMs});
        if(state.state!=='BACKED_UP')reasons.push({itemId:item.id,state:state.state,stale:Boolean(state.stale),provider:state.provider??null});
      }
      return {allowed:reasons.length===0,reasons};
    },
  };
}
