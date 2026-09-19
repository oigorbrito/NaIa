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
