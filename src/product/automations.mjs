import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const AutomationTriggerKind = Object.freeze({ SCHEDULE:'SCHEDULE', EVENT:'EVENT' });

function clone(value){ return value==null?value:structuredClone(value); }
function pathValue(value,path){ return String(path??'').split('.').filter(Boolean).reduce((acc,key)=>acc==null?undefined:acc[key],value); }

function normalizeTrigger(trigger={}){
  const kind=String(trigger.kind??'').toUpperCase();
  if(!Object.values(AutomationTriggerKind).includes(kind)) throw new Error('unsupported automation trigger: '+kind);
  if(kind==='SCHEDULE'){
    const schedule=String(trigger.schedule??'').trim(); if(!schedule) throw new Error('schedule trigger requires schedule');
    return {kind,schedule,timezone:String(trigger.timezone??'UTC'),metadata:clone(trigger.metadata??{})};
  }
  const event=String(trigger.event??'').trim(); if(!event) throw new Error('event trigger requires event');
  return {kind,event,source:String(trigger.source??''),metadata:clone(trigger.metadata??{})};
}

function normalizeAction(action){
  const tool=String(action?.tool??'').trim();
  const risk=String(action?.risk??'').toUpperCase();
  if(!tool) throw new Error('automation action tool is required');
  if(!['READ_ONLY','LOCAL_WRITE','EXTERNAL_WRITE','SENSITIVE'].includes(risk)) throw new Error('unsupported automation action risk: '+risk);
  return {tool,capability:String(action?.capability??tool),input:clone(action.input??{}),risk,requiresApproval:Boolean(action.requiresApproval)||risk!=='READ_ONLY'};
}

export function evaluateAutomationCondition(condition,payload={}){
  if(!condition) return true;
  const op=String(condition.op??'EQ').toUpperCase();
  if(op==='ALL') return (condition.conditions??[]).every((item)=>evaluateAutomationCondition(item,payload));
  if(op==='ANY') return (condition.conditions??[]).some((item)=>evaluateAutomationCondition(item,payload));
  const actual=pathValue(payload,condition.path);
  const expected=condition.value;
  if(op==='EQ') return actual===expected;
  if(op==='NE') return actual!==expected;
  if(op==='LTE') return Number(actual)<=Number(expected);
  if(op==='GTE') return Number(actual)>=Number(expected);
  if(op==='EXISTS') return actual!==undefined&&actual!==null;
  throw new Error('unsupported automation condition operator: '+op);
}

export function createMemoryAutomationStore(){
  const automations=new Map(); const deliveries=new Map();
  return {
    async save(row){ automations.set(row.id,clone(row)); return clone(row); },
    async get(id){ const row=automations.get(String(id)); return row?clone(row):null; },
    async list({userId}={}){ return [...automations.values()].filter((row)=>!userId||row.userId===userId).map(clone); },
    async delete(id){ return automations.delete(String(id)); },
    async claimDelivery(key,record){ if(deliveries.has(key)) return false; deliveries.set(key,clone(record)); return true; },
    async saveDelivery(key,record){ deliveries.set(key,clone(record)); return clone(record); },
    async getDelivery(key){ const row=deliveries.get(key); return row?clone(row):null; },
  };
}

async function readAutomationJson(path){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error?.code==='ENOENT')return {automations:{},deliveries:{}};throw error;}
}
async function writeAutomationJsonAtomic(path,value){
  await mkdir(dirname(path),{recursive:true});
  const temp=`${path}.${process.pid}.tmp`;
  await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');
  await rename(temp,path);
}

export function createFileAutomationStore({rootDir='.naia'}={}){
  const path=join(rootDir,'automations.json');
  let chain=Promise.resolve();
  async function mutate(fn){
    chain=chain.catch(()=>{}).then(async()=>{const data=await readAutomationJson(path);const result=await fn(data);await writeAutomationJsonAtomic(path,data);return clone(result);});
    return chain;
  }
  return {
    path,
    async save(row){return mutate((data)=>{data.automations[row.id]=clone(row);return row;});},
    async get(id){const data=await readAutomationJson(path);return data.automations?.[String(id)]?clone(data.automations[String(id)]):null;},
    async list({userId}={}){const data=await readAutomationJson(path);return Object.values(data.automations??{}).filter((row)=>!userId||row.userId===userId).map(clone);},
    async delete(id){return mutate((data)=>{const key=String(id);const existed=Object.prototype.hasOwnProperty.call(data.automations,key);delete data.automations[key];return existed;});},
    async claimDelivery(key,record){return mutate((data)=>{if(data.deliveries[key])return false;data.deliveries[key]=clone(record);return true;});},
    async saveDelivery(key,record){return mutate((data)=>{data.deliveries[key]=clone(record);return record;});},
    async getDelivery(key){const data=await readAutomationJson(path);return data.deliveries?.[key]?clone(data.deliveries[key]):null;},
  };
}

export function createNaiaAutomationDispatcher(naia){
  if(!naia||typeof naia.pursueAction!=='function') throw new Error('NaIA pursueAction service is required');
  return {
    policyControlled:true,
    async dispatch({automation,deliveryId,payload}){
      return naia.pursueAction({
        id:`automation:${automation.id}:${deliveryId}`,
        title:`Automation: ${automation.name}`,
        description:`Triggered ${automation.trigger.kind.toLowerCase()} automation`,
        intent:'AUTOMATION_ACTION',
        action:{...clone(automation.action),input:{...clone(automation.action.input),triggerPayload:clone(payload)}},
        confirmation:automation.confirmation?clone(automation.confirmation):null,
      });
    },
  };
}

export function createAutomationService({store=createMemoryAutomationStore(),dispatcher,quotaPolicy=null,meter=null,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!dispatcher?.policyControlled||typeof dispatcher.dispatch!=='function') throw new Error('policy-controlled automation dispatcher is required');
  function matches(expected,actual={}){
    const kind=String(actual.kind??'').toUpperCase(); if(kind!==expected.kind) return false;
    if(expected.kind==='EVENT'&&String(actual.event??'')!==expected.event) return false;
    if(expected.kind==='EVENT'&&expected.source&&actual.source&&String(actual.source)!==expected.source) return false;
    return true;
  }
  return {
    async create({userId,name,trigger,condition=null,action,enabled=true,confirmation=null,metadata={}}){
      if(!userId||!String(name??'').trim()) throw new Error('userId and automation name are required');
      const row={id:idFactory(),userId,name:String(name).trim(),enabled:Boolean(enabled),trigger:normalizeTrigger(trigger),condition:clone(condition),action:normalizeAction(action),confirmation:clone(confirmation),metadata:clone(metadata),createdAt:now(),updatedAt:now()};
      await store.save(row); return clone(row);
    },
    async get(id){ const row=await store.get(id); if(!row) throw new Error('automation not found: '+id); return row; },
    async list(userId){ return store.list({userId}); },
    async setEnabled(id,enabled){ const row=await this.get(id); row.enabled=Boolean(enabled); row.updatedAt=now(); await store.save(row); return clone(row); },
    async delete(id){ return {deleted:await store.delete(id),id}; },
    async trigger(id,{deliveryId,trigger,payload={}}={}){
      const automation=await this.get(id);
      if(!automation.enabled) return {status:'DISABLED',automationId:id};
      if(!deliveryId) throw new Error('deliveryId is required');
      if(!matches(automation.trigger,trigger)){ const e=new Error('automation trigger mismatch'); e.code='TRIGGER_MISMATCH'; throw e; }
      const key=automation.id+':'+deliveryId;
      const claimed=await store.claimDelivery(key,{status:'CLAIMED',automationId:id,deliveryId,at:now()});
      if(!claimed) return {status:'DUPLICATE',duplicate:true,delivery:await store.getDelivery(key)};
      const matched=evaluateAutomationCondition(automation.condition,payload);
      if(!matched){ const record={status:'NO_ACTION',automationId:id,deliveryId,matched:false,at:now()}; await store.saveDelivery(key,record); return clone(record); }
      if(quotaPolicy?.authorize){
        const gate=await quotaPolicy.authorize({userId:automation.userId,capability:automation.action.capability,usage:{metric:'executions.daily',window:'DAY',amount:1}});
        if(!gate.allowed){ const record={status:gate.reason,automationId:id,deliveryId,matched:true,quota:clone(gate),at:now()}; await store.saveDelivery(key,record); return clone(record); }
      }
      try{
        const result=await dispatcher.dispatch({automation,deliveryId,payload:clone(payload)});
        if(meter?.consume) await meter.consume({userId:automation.userId,metric:'executions.daily',window:'DAY',logicalId:`automation:${automation.id}:${deliveryId}`});
        const record={status:'DISPATCHED',automationId:id,deliveryId,matched:true,result:clone(result),at:now()};
        await store.saveDelivery(key,record); return clone(record);
      }catch(error){
        const record={status:'FAILED',automationId:id,deliveryId,matched:true,error:{code:error?.code??'DISPATCH_FAILED',message:error?.message??String(error),retryable:Boolean(error?.retryable)},at:now()};
        await store.saveDelivery(key,record); throw error;
      }
    },
  };
}
