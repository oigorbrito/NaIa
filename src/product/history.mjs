import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SECRET_KEY=/authorization|password|token|secret|api[_-]?key|credential/i;
export const DEFAULT_HISTORY_RETENTION_DAYS=Object.freeze({FREE:30,PRO:365,ULTRA:null});

function clone(v){return v==null?v:structuredClone(v);}
function sanitize(value){
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){if(SECRET_KEY.test(k))continue;out[k]=sanitize(v);}return out;}
  return value;
}
function text(value){return String(value??'').trim();}
function dayMs(days){return Number(days)*24*60*60*1000;}

export function createMemoryHistoryStore(){
  const rows=new Map();
  return {
    async save(row){rows.set(row.id,clone(row));return clone(row);},
    async get(id){const row=rows.get(String(id));return row?clone(row):null;},
    async list(userId){return [...rows.values()].filter(r=>r.userId===userId).map(clone);},
    async delete(id){return rows.delete(String(id));},
  };
}

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {};throw error;}}
async function writeAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileHistoryStore({rootDir='.naia'}={}){
  const path=join(rootDir,'history-index.json');let chain=Promise.resolve();
  return {
    path,
    async save(row){chain=chain.catch(()=>{}).then(async()=>{const all=await readJson(path);all[row.id]=clone(row);await writeAtomic(path,all);return clone(row);});return chain;},
    async get(id){const all=await readJson(path);return all[id]?clone(all[id]):null;},
    async list(userId){const all=await readJson(path);return Object.values(all).filter(r=>r.userId===userId).map(clone);},
    async delete(id){chain=chain.catch(()=>{}).then(async()=>{const all=await readJson(path);const existed=Object.prototype.hasOwnProperty.call(all,id);delete all[id];await writeAtomic(path,all);return existed;});return chain;},
  };
}

function recordText(row){return [row.title,row.description,row.status,...row.capabilities,...row.providers,JSON.stringify(row.conversation),JSON.stringify(row.evidence)].join(' ').toLowerCase();}

export function createHistoryService({store=createMemoryHistoryStore(),entitlements,retentionDays=DEFAULT_HISTORY_RETENTION_DAYS,idFactory=randomUUID,now=()=>new Date()}={}){
  if(!entitlements||typeof entitlements.resolve!=='function')throw new Error('entitlement service is required');
  async function policy(userId){const resolved=await entitlements.resolve(userId);const days=retentionDays[resolved.planId];return {planId:resolved.planId,days:days===undefined?retentionDays.FREE:days};}
  function retained(row,p,at){if(p.days==null)return true;return new Date(row.occurredAt).getTime()>=at.getTime()-dayMs(p.days);}
  async function visibleRows(userId,{prune=false}={}){
    const p=await policy(userId);const at=now();const rows=await store.list(userId);const kept=[];
    for(const row of rows){if(retained(row,p,at))kept.push(row);else if(prune)await store.delete(row.id);}
    return {rows:kept,policy:p};
  }
  return {
    async ingestObjective({userId,snapshot,provider=null,conversation=snapshot?.conversation??[]}){
      if(!userId||!snapshot?.objective)throw new Error('userId and objective snapshot are required');
      const objective=snapshot.objective;const plan=snapshot.plan??{};const evidence=snapshot.evidence??[];
      const capabilities=[...new Set((plan.steps??[]).map(s=>s.action?.tool).filter(Boolean))];
      const providers=[...new Set([provider,...evidence.map(e=>e.provider)].filter(Boolean).map(String))];
      const row=sanitize({
        id:idFactory(),userId,objectiveId:objective.id,title:objective.title,description:objective.description??'',status:objective.status,
        occurredAt:objective.updatedAt??objective.createdAt??now().toISOString(),createdAt:objective.createdAt??null,
        capabilities,providers,approvals:objective.approvals??[],confirmations:objective.confirmations??[],
        plan:{intent:plan.intent??null,steps:(plan.steps??[]).map(s=>({id:s.id,kind:s.kind,status:s.status,tool:s.action?.tool??null,risk:s.action?.risk??null}))},
        evidence,conversation,
      });
      await store.save(row);return clone(row);
    },
    async search({userId,query='',from=null,to=null,capability=null,provider=null,status=null,limit=100}){
      const {rows,policy}=await visibleRows(userId);const q=text(query).toLowerCase();
      const filtered=rows.filter(row=>{
        const at=new Date(row.occurredAt).getTime();
        if(from&&at<new Date(from).getTime())return false;if(to&&at>new Date(to).getTime())return false;
        if(capability&&!row.capabilities.includes(capability))return false;if(provider&&!row.providers.includes(provider))return false;if(status&&row.status!==status)return false;
        return !q||recordText(row).includes(q);
      }).sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))||a.id.localeCompare(b.id)).slice(0,Math.max(1,Number(limit)||100));
      return {planId:policy.planId,retentionDays:policy.days,items:clone(filtered)};
    },
    async delete({userId,id}){const row=await store.get(id);if(!row||row.userId!==userId)return {deleted:false};return {deleted:await store.delete(id),id};},
    async export(userId){const {rows,policy}=await visibleRows(userId);return {planId:policy.planId,retentionDays:policy.days,exportedAt:now().toISOString(),items:sanitize(rows)};},
    async applyRetention(userId){const before=(await store.list(userId)).length;const {rows,policy}=await visibleRows(userId,{prune:true});return {planId:policy.planId,retentionDays:policy.days,deleted:before-rows.length,remaining:rows.length};},
  };
}
