import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
function clone(v){return v==null?v:structuredClone(v);}
function norm(v){return String(v??'').trim().toLowerCase();}
function ts(v){const n=new Date(v).getTime();return Number.isFinite(n)?n:null;}

function priorityOf(signal,nowMs){
  const type=String(signal.type??'CHANGE').toUpperCase();
  if(type==='CONFLICT') return 100;
  if(type==='DEADLINE'){ const due=ts(signal.dueAt); if(due!=null&&due-nowMs<=24*3600000) return 95; return 80; }
  if(type==='PENDING_REPLY') return 75;
  if(type==='ALERT') return 70;
  return 50;
}

export function normalizeRadarSignal(input,now=new Date().toISOString()){
  if(!input?.id||!input?.source) throw new Error('radar signal id and source are required');
  const occurredAt=input.occurredAt??now;
  return {
    id:String(input.id),source:String(input.source),topicKey:String(input.topicKey??input.id),
    type:String(input.type??'CHANGE').toUpperCase(),title:String(input.title??'').trim(),summary:String(input.summary??'').trim(),
    occurredAt,dueAt:input.dueAt??null,staleAfter:input.staleAfter??null,
    action:clone(input.action??null),metadata:clone(input.metadata??{}),
  };
}

export function buildRadarDigest(signals,{disabledSources=[],staleAfterMs=48*3600000,now=new Date().toISOString()}={}){
  const nowMs=ts(now); if(nowMs==null) throw new Error('invalid radar now');
  const disabled=new Set(disabledSources.map(norm));
  const seen=new Set(); const groups=new Map();
  for(const raw of signals??[]){
    const s=normalizeRadarSignal(raw,now);
    if(disabled.has(norm(s.source))) continue;
    const occurred=ts(s.occurredAt);
    const staleBoundary=s.staleAfter?ts(s.staleAfter):(occurred==null?null:occurred+staleAfterMs);
    if(staleBoundary!=null&&staleBoundary<nowMs) continue;
    const dedupKey=`${norm(s.source)}:${s.id}`; if(seen.has(dedupKey)) continue; seen.add(dedupKey);
    const key=norm(s.topicKey);
    const current=groups.get(key)??{topicKey:s.topicKey,title:s.title||s.topicKey,priority:0,sources:new Set(),items:[],actions:[]};
    current.priority=Math.max(current.priority,priorityOf(s,nowMs));
    current.sources.add(s.source);
    current.items.push(s);
    if(s.action) current.actions.push(clone(s.action));
    groups.set(key,current);
  }
  const topics=[...groups.values()].map((g)=>({
    topicKey:g.topicKey,title:g.title,priority:g.priority,sources:[...g.sources].sort(),
    items:g.items.sort((a,b)=>String(b.occurredAt).localeCompare(String(a.occurredAt))),actions:g.actions,
  })).sort((a,b)=>b.priority-a.priority||a.title.localeCompare(b.title));
  return {generatedAt:now,topics,totalTopics:topics.length};
}

export function createRadarPreferenceStore(){
  const rows=new Map();
  return {
    async set(userId,{disabledSources=[]}={}){const row={userId,disabledSources:[...new Set(disabledSources.map(String))]};rows.set(userId,clone(row));return clone(row);},
    async get(userId){return clone(rows.get(userId)??{userId,disabledSources:[]});},
  };
}

async function readRadarJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {preferences:{}};throw error;}}
async function writeRadarJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileRadarPreferenceStore({rootDir='.naia'}={}){
  const path=join(rootDir,'radar-preferences.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readRadarJson(path);const result=await fn(data);await writeRadarJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async set(userId,{disabledSources=[]}={}){return mutate(data=>{const row={userId,disabledSources:[...new Set(disabledSources.map(String))]};data.preferences[userId]=clone(row);return row;});},
    async get(userId){const data=await readRadarJson(path);return clone(data.preferences?.[String(userId)]??{userId,disabledSources:[]});},
  };
}

export function createRadarSourceAdapter({name,readSignals}={}){
  const source=String(name??'').trim();if(!source||typeof readSignals!=='function')throw new Error('radar source name/readSignals are required');
  return {name:source,async read(userId){return clone(await readSignals({userId}));}};
}

export function createRadarService({sources=[],preferences=createRadarPreferenceStore(),now=()=>new Date().toISOString(),staleAfterMs=48*3600000}={}){
  const sourceMap=new Map(sources.map(source=>[String(source.name).toLowerCase(),source]));
  return {
    async setDisabledSources(userId,disabledSources=[]){return preferences.set(userId,{disabledSources});},
    async preferences(userId){return preferences.get(userId);},
    async digest(userId){
      const pref=await preferences.get(userId);const disabled=new Set((pref.disabledSources??[]).map(norm));const signals=[];const sourceStatus=[];
      for(const [key,source] of sourceMap){
        if(disabled.has(key)){sourceStatus.push({source:source.name,status:'DISABLED'});continue;}
        try{const rows=await source.read(userId);signals.push(...(rows??[]).map(row=>({...row,source:row.source??source.name})));sourceStatus.push({source:source.name,status:'OK',count:(rows??[]).length});}
        catch(error){sourceStatus.push({source:source.name,status:'FAILED',code:error?.code??'SOURCE_FAILED',retryable:Boolean(error?.retryable)});}
      }
      return {...buildRadarDigest(signals,{disabledSources:pref.disabledSources,staleAfterMs,now:now()}),sourceStatus};
    },
  };
}
