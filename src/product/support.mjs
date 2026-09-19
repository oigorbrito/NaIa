import { createHash, randomUUID } from 'node:crypto';

const SECRET_KEY=/authorization|password|token|secret|api[_-]?key|credential|hmac/i;
const SECRET_PATTERNS=[
  /Bearer\s+[A-Za-z0-9._~+\/=\-]+/gi,
  /\b(?:token|secret|password|api[_-]?key|hmac)\s*[=:]\s*[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsha256=[a-f0-9]{32,}\b/gi,
];

function clone(v){return v==null?v:structuredClone(v);}
function redactText(value){let text=String(value??'');for(const pattern of SECRET_PATTERNS)text=text.replace(pattern,'[REDACTED]');return text;}
function sanitize(value){
  if(typeof value==='string')return redactText(value);
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object'){const out={};for(const [key,item] of Object.entries(value)){if(SECRET_KEY.test(key))continue;out[key]=sanitize(item);}return out;}
  return value;
}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

function errorMetadata(evidence=[]){
  return evidence.filter(row=>row?.ok===false||/FAILED|ERROR/i.test(String(row?.type??''))).map(row=>({
    type:row.type??null,tool:row.tool??null,at:row.at??null,
    error:row.error??row.output?.error??row.reason??null,
  }));
}

export function createSupportService({entitlements,historyIndex,version='unknown',runtimeInfo={},idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!entitlements||typeof entitlements.attribute!=='function')throw new Error('entitlement attribute service is required');
  if(!historyIndex||typeof historyIndex.search!=='function')throw new Error('history index is required');
  return {
    async priority(userId){
      const attr=await entitlements.attribute(userId,'supportPriority');
      return {planId:attr.planId,priority:attr.value??'STANDARD',eligible:attr.value==='PRIORITY'};
    },

    async prepareBundle({userId,objectiveIds=[],limit=25}){
      const priority=await this.priority(userId);
      if(!priority.eligible){const e=new Error('priority support is not included in current plan');e.code='NOT_ENTITLED';throw e;}
      const history=await historyIndex.search({userId,limit:Math.max(limit,objectiveIds.length||0)||25});
      const selected=history.items.filter(row=>!objectiveIds.length||objectiveIds.includes(row.objectiveId)).slice(0,limit).map(row=>({
        objectiveId:row.objectiveId,status:row.status,occurredAt:row.occurredAt,capabilities:clone(row.capabilities??[]),providers:clone(row.providers??[]),
        approvalsCount:(row.approvals??[]).length,confirmationsCount:(row.confirmations??[]).length,errors:errorMetadata(row.evidence??[]),
      }));
      const payload=sanitize({
        version:String(version),runtimeInfo:clone(runtimeInfo),planId:priority.planId,supportPriority:priority.priority,
        generatedAt:now(),objectiveCount:selected.length,objectives:selected,
      });
      const bundle={id:idFactory(),fingerprint:digest(payload),payload};
      return clone(bundle);
    },

    inspect(bundle){return clone(bundle);},

    async routing(userId){
      const p=await this.priority(userId);
      return {queue:p.eligible?'PRIORITY':'STANDARD',priority:p.priority,planId:p.planId};
    },
  };
}

export function scanSupportBundleForSecrets(bundle){
  const encoded=JSON.stringify(bundle);
  const matches=[];
  for(const pattern of SECRET_PATTERNS){pattern.lastIndex=0;if(pattern.test(encoded))matches.push(pattern.source);}
  return {clean:matches.length===0,matches};
}
