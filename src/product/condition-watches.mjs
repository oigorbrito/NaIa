import { createHash, randomUUID } from 'node:crypto';

function clone(value){ return value==null?value:structuredClone(value); }
function signature(value){ return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizeObservation(input,now){
  return {
    id:String(input?.id??randomUUID()),
    source:String(input?.source??'unknown'),
    observedAt:String(input?.observedAt??now()),
    value:input?.value==null?null:Number(input.value),
    state:input?.state==null?null:String(input.state),
    inStock:input?.inStock==null?null:Boolean(input.inStock),
    available:input?.available==null?null:Boolean(input.available),
    slots:Array.isArray(input?.slots)?clone(input.slots):[],
    provenance:clone(input?.provenance??{}),
  };
}

function semanticSignature(observation){
  return signature({source:observation.source,value:observation.value,state:observation.state,inStock:observation.inStock,available:observation.available,slots:observation.slots});
}

export function evaluateWatchPredicate(predicate,current,previous=null){
  const kind=String(predicate?.kind??'').toUpperCase();
  if(kind==='PRICE_LTE') return Number.isFinite(current.value)&&current.value<=Number(predicate.target);
  if(kind==='PRICE_DROP_PCT'){
    if(!previous||!Number.isFinite(previous.value)||!Number.isFinite(current.value)||previous.value<=0) return false;
    const drop=((previous.value-current.value)/previous.value)*100;
    return drop>=Number(predicate.percentage);
  }
  if(kind==='IN_STOCK') return current.inStock===true||String(current.state??'').toUpperCase()==='IN_STOCK';
  if(kind==='AVAILABLE_SLOT_FOUND') return current.available===true||current.slots.length>0;
  if(kind==='STATE_CHANGED') return Boolean(previous)&&current.state!==null&&previous.state!==null&&current.state!==previous.state;
  throw new Error('unsupported watch predicate: '+kind);
}

export function createMemoryConditionWatchStore(){
  const watches=new Map(); const observations=[]; const failures=[];
  return {
    async saveWatch(row){ watches.set(row.id,clone(row)); return clone(row); },
    async getWatch(id){ const row=watches.get(String(id)); return row?clone(row):null; },
    async listWatches({userId}={}){ return [...watches.values()].filter((row)=>!userId||row.userId===userId).map(clone); },
    async appendObservation(row){ observations.push(clone(row)); return clone(row); },
    async listObservations(watchId){ return observations.filter((row)=>row.watchId===watchId).map(clone); },
    async appendFailure(row){ failures.push(clone(row)); return clone(row); },
    async listFailures(watchId){ return failures.filter((row)=>row.watchId===watchId).map(clone); },
  };
}

export function createConditionWatchService({store=createMemoryConditionWatchStore(),automationService,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!automationService||typeof automationService.create!=='function'||typeof automationService.trigger!=='function') throw new Error('automation service is required');
  async function requireWatch(id){ const row=await store.getWatch(id); if(!row) throw new Error('watch not found: '+id); return row; }
  return {
    async create({userId,name,predicate,cadence='HOURLY',source='provider',maxAgeMs=3600000,action}){
      if(!userId||!String(name??'').trim()) throw new Error('userId and watch name are required');
      // Validate predicate eagerly.
      evaluateWatchPredicate(predicate,{value:0,state:'A',inStock:false,available:false,slots:[]},null);
      const automation=await automationService.create({
        userId,name:'Watch notification: '+String(name).trim(),enabled:true,
        trigger:{kind:'EVENT',event:'condition.watch.matched',source:'condition-watch'},
        action,metadata:{watch:true},
      });
      const row={id:idFactory(),userId,name:String(name).trim(),predicate:clone(predicate),cadence,source,maxAgeMs:Number(maxAgeMs),status:'ACTIVE',automationId:automation.id,lastSignature:null,lastObservation:null,lastMatched:false,notificationSequence:0,createdAt:now(),updatedAt:now()};
      await store.saveWatch(row); return clone(row);
    },
    async get(id){ return requireWatch(id); },
    async list(userId){ return store.listWatches({userId}); },
    async pause(id){ const row=await requireWatch(id); row.status='PAUSED'; row.updatedAt=now(); await store.saveWatch(row); await automationService.setEnabled(row.automationId,false); return clone(row); },
    async resume(id){ const row=await requireWatch(id); if(row.status==='CANCELLED') throw new Error('cancelled watch cannot resume'); row.status='ACTIVE'; row.updatedAt=now(); await store.saveWatch(row); await automationService.setEnabled(row.automationId,true); return clone(row); },
    async cancel(id){ const row=await requireWatch(id); row.status='CANCELLED'; row.updatedAt=now(); await store.saveWatch(row); await automationService.setEnabled(row.automationId,false); return clone(row); },
    async observe(id,input){
      const watch=await requireWatch(id);
      if(watch.status!=='ACTIVE') return {status:watch.status,notified:false};
      const observation=normalizeObservation(input,now);
      const ageMs=new Date(now()).getTime()-new Date(observation.observedAt).getTime();
      if(Number.isFinite(watch.maxAgeMs)&&ageMs>watch.maxAgeMs){
        await store.appendObservation({watchId:id,status:'STALE',observation,recordedAt:now()});
        return {status:'STALE',notified:false,observation};
      }
      const sig=semanticSignature(observation);
      if(sig===watch.lastSignature){
        await store.appendObservation({watchId:id,status:'DUPLICATE_UNCHANGED',observation,recordedAt:now()});
        return {status:'DUPLICATE_UNCHANGED',notified:false,observation};
      }
      const previous=watch.lastObservation;
      const matched=evaluateWatchPredicate(watch.predicate,observation,previous);
      const predicateKind=String(watch.predicate.kind).toUpperCase();
      const shouldNotify=predicateKind==='STATE_CHANGED'?matched:(matched&&!watch.lastMatched);
      watch.lastSignature=sig; watch.lastObservation=clone(observation); watch.lastMatched=matched; watch.updatedAt=now();
      let automation=null;
      if(shouldNotify){
        watch.notificationSequence+=1;
        const deliveryId=`watch:${watch.id}:notification:${watch.notificationSequence}`;
        automation=await automationService.trigger(watch.automationId,{deliveryId,trigger:{kind:'EVENT',event:'condition.watch.matched',source:'condition-watch'},payload:{watchId:watch.id,predicate:clone(watch.predicate),observation:clone(observation),previous:clone(previous)}});
      }
      await store.saveWatch(watch);
      await store.appendObservation({watchId:id,status:matched?'MATCHED':'OBSERVED',matched,notified:shouldNotify,observation,recordedAt:now()});
      return {status:matched?'MATCHED':'OBSERVED',matched,notified:shouldNotify,observation,automation};
    },
    async recordFailure(id,{source='provider',code='PROVIDER_ERROR',retryable=false,message=null}={}){
      const watch=await requireWatch(id);
      const failure={watchId:id,source,code,retryable:Boolean(retryable),message,at:now()};
      await store.appendFailure(failure);
      return {status:'PROVIDER_FAILED',notified:false,failure,watchStatus:watch.status};
    },
    async observations(id){ return store.listObservations(id); },
    async failures(id){ return store.listFailures(id); },
  };
}
