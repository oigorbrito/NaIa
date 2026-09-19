import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){return v==null?v:structuredClone(v);}
function fp(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}

export function createMemoryMediaCleanupStore(){
  const actions=new Map();
  return {
    async saveAction(row){actions.set(row.id,clone(row));return clone(row);},
    async getAction(id){const row=actions.get(String(id));return row?clone(row):null;},
  };
}

async function readCleanupJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {actions:{}};throw error;}}
async function writeCleanupJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileMediaCleanupStore({rootDir='.naia'}={}){
  const path=join(rootDir,'media-cleanup.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readCleanupJson(path);const result=await fn(data);await writeCleanupJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async saveAction(row){return mutate(data=>{data.actions[row.id]=clone(row);return row;});},
    async getAction(id){const data=await readCleanupJson(path);return data.actions?.[String(id)]?clone(data.actions[String(id)]):null;},
  };
}

export function createFixtureMediaCleanupAdapter({platform='android',items=[],supportsTrash=true,failures={}}={}){
  const current=new Map(items.map(item=>[String(item.id),clone(item)]));
  const calls=[];
  return {
    platform,
    supports:{trash:Boolean(supportsTrash),delete:true},
    async inspect(id){const row=current.get(String(id));return row?clone(row):null;},
    async mutate({id,mode,idempotencyKey}){
      calls.push({id:String(id),mode,idempotencyKey});
      const failure=failures[String(id)];
      if(failure){const e=new Error(failure.message??'cleanup failed');e.code=failure.code??'DELETE_FAILED';e.retryable=Boolean(failure.retryable);throw e;}
      const row=current.get(String(id));if(!row){const e=new Error('media item not found');e.code='NOT_FOUND';throw e;}
      if(mode==='trash'&&!supportsTrash){const e=new Error('trash unsupported');e.code='CAPABILITY_UNAVAILABLE';throw e;}
      current.delete(String(id));
      return {id:String(id),mode,status:mode==='trash'?'TRASHED':'DELETED'};
    },
    calls(){return clone(calls);},
  };
}

function normalizeSelection(items=[]){
  const seen=new Set();const out=[];
  for(const item of items){
    const id=String(item?.id??'').trim();if(!id)throw new Error('media cleanup item id is required');
    if(seen.has(id))continue;seen.add(id);
    out.push({id,stableSourceId:item.stableSourceId??null,version:String(item.version??item.contentVersion??`${item.sizeBytes??''}:${item.modifiedAt??item.createdAt??''}`)});
  }
  return out;
}

export function createMediaCleanupService({store=createMemoryMediaCleanupStore(),adapter,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!adapter||typeof adapter.inspect!=='function'||typeof adapter.mutate!=='function')throw new Error('media cleanup adapter is required');
  async function requireAction(id){const row=await store.getAction(id);if(!row)throw new Error('media cleanup action not found: '+id);return row;}
  return {
    async prepare({userId,items,preferTrash=true,selectionReason=null}){
      if(!userId)throw new Error('userId is required');
      const selected=normalizeSelection(items);if(!selected.length)throw new Error('at least one media item is required');
      const mode=preferTrash&&adapter.supports?.trash?'trash':'delete';
      if(mode==='delete'&&adapter.supports?.delete===false){const e=new Error('media deletion unsupported');e.code='CAPABILITY_UNAVAILABLE';throw e;}
      const payload={userId,platform:adapter.platform??'unknown',mode,items:selected,selectionReason};
      const row={id:idFactory(),userId,status:'PREPARED',fingerprint:fp(payload),payload,results:{},createdAt:now(),updatedAt:now()};
      await store.saveAction(row);return clone(row);
    },

    async executeRuntimeApproved({actionId,fingerprint,idempotencyKey}){
      const action=await requireAction(actionId);
      if(action.fingerprint!==fingerprint){const e=new Error('media cleanup approval mismatch');e.code='ACTION_STALE';throw e;}
      if(action.status==='CANCELLED'){const e=new Error('media cleanup action cancelled');e.code='APPROVAL_REQUIRED';throw e;}
      action.status='APPROVED';action.updatedAt=now();await store.saveAction(action);
      return this.execute({actionId,fingerprint,idempotencyKey});
    },

    async execute({actionId,fingerprint,idempotencyKey}){
      const action=await requireAction(actionId);
      if(!idempotencyKey)throw new Error('idempotencyKey is required');
      if(action.fingerprint!==fingerprint){const e=new Error('media cleanup approval mismatch');e.code='ACTION_STALE';throw e;}
      if(action.status!=='APPROVED'&&action.status!=='PARTIAL'){const e=new Error('media cleanup requires approval');e.code='APPROVAL_REQUIRED';throw e;}
      for(const item of action.payload.items){
        const prior=action.results[item.id];
        if(prior&&['TRASHED','DELETED','SKIPPED'].includes(prior.status))continue;
        if(prior?.status==='FAILED'&&!prior.retryable)continue;
        const current=await adapter.inspect(item.id);
        if(!current){action.results[item.id]={status:'SKIPPED',reason:'NOT_FOUND',at:now()};await store.saveAction(action);continue;}
        const currentVersion=String(current.version??current.contentVersion??`${current.sizeBytes??''}:${current.modifiedAt??current.createdAt??''}`);
        if(currentVersion!==item.version||(item.stableSourceId&&current.stableSourceId&&String(current.stableSourceId)!==String(item.stableSourceId))){
          action.results[item.id]={status:'SKIPPED',reason:'STALE_REFERENCE',at:now()};await store.saveAction(action);continue;
        }
        try{
          const result=await adapter.mutate({id:item.id,mode:action.payload.mode,idempotencyKey:`${idempotencyKey}:${item.id}`});
          action.results[item.id]={status:result?.status??(action.payload.mode==='trash'?'TRASHED':'DELETED'),mode:action.payload.mode,at:now()};
        }catch(error){
          action.results[item.id]={status:'FAILED',code:error?.code??'DELETE_FAILED',retryable:Boolean(error?.retryable),at:now()};
        }
        action.updatedAt=now();await store.saveAction(action);
      }
      const rows=Object.entries(action.results).map(([itemId,result])=>({itemId,...clone(result)}));
      const retryable=rows.some(r=>r.status==='FAILED'&&r.retryable);
      const failed=rows.some(r=>r.status==='FAILED');
      action.status=retryable?'PARTIAL':failed?'FAILED':'COMPLETED';action.updatedAt=now();await store.saveAction(action);
      return {actionId:action.id,status:action.status,results:rows};
    },

    async cancel(actionId){const action=await requireAction(actionId);if(!['COMPLETED','FAILED'].includes(action.status))action.status='CANCELLED';action.updatedAt=now();await store.saveAction(action);return clone(action);},
    async getAction(id){return requireAction(id);},
  };
}

export function registerMediaCleanupCapability(naia,{service}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service)throw new Error('media cleanup service is required');
  return naia.registerCapability({
    name:'media.cleanup.commit',
    tool:{risk:'EXTERNAL_WRITE',capability:'media.cleanup',description:'Deletes or trashes one concrete approved media selection',async run(input){return service.executeRuntimeApproved(input);}},
  });
}

export async function proposeMediaCleanup(naia,action,{idempotencyKey}={}){
  if(!naia||typeof naia.pursueAction!=='function')throw new Error('NaIA pursueAction is required');
  if(!action?.id||!action?.fingerprint)throw new Error('prepared media cleanup action is required');
  return naia.pursueAction({
    id:`media-cleanup-objective:${action.id}`,title:`Clean up ${action.payload.items.length} media items`,intent:'MEDIA_CLEANUP',
    confirmation:{required:true,id:`media-cleanup:${action.id}:${action.fingerprint}`,payload:{platform:action.payload.platform,mode:action.payload.mode,itemIds:action.payload.items.map(item=>item.id)}},
    action:{tool:'media.cleanup.commit',input:{actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:idempotencyKey??`media-cleanup:${action.id}`},risk:'EXTERNAL_WRITE',requiresApproval:true},
  });
}
