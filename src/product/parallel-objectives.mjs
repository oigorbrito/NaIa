import { randomUUID } from 'node:crypto';

function clone(v){return v==null?v:structuredClone(v);}

export function createParallelObjectiveService({entitlements,meter=null,executor,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!entitlements||typeof entitlements.limit!=='function')throw new Error('entitlement service is required');
  if(!executor||typeof executor.run!=='function')throw new Error('objective executor is required');
  const jobs=new Map();
  const queues=new Map();
  const activeByUser=new Map();
  const idempotency=new Map();

  function queueFor(userId){if(!queues.has(userId))queues.set(userId,[]);return queues.get(userId);}
  function activeSet(userId){if(!activeByUser.has(userId))activeByUser.set(userId,new Set());return activeByUser.get(userId);}

  async function limitFor(userId){const row=await entitlements.limit(userId,'objectives.concurrent');return Math.max(1,Number(row.value??1));}

  async function pump(userId){
    const queue=queueFor(userId);const active=activeSet(userId);const limit=await limitFor(userId);
    while(active.size<limit&&queue.length){
      const id=queue.shift();const job=jobs.get(id);if(!job||job.status!=='QUEUED')continue;
      job.status='ACTIVE';job.startedAt=now();active.add(id);
      if(meter?.consume){
        const metering=await meter.consume({userId,metric:'executions.daily',window:'DAY',logicalId:`parallel:${job.logicalId}`});
        job.metering=clone(metering);
        if(!metering.ok){job.status='FAILED';job.error={code:metering.code??'LIMIT_REACHED',message:'execution quota reached'};job.completedAt=now();active.delete(id);continue;}
      }
      Promise.resolve().then(()=>executor.run({userId,objective:clone(job.objective),signal:job.controller.signal,logicalId:job.logicalId})).then((result)=>{
        if(job.status==='CANCELLED')return;
        job.status='COMPLETED';job.result=clone(result);job.completedAt=now();
      }).catch((error)=>{
        if(job.status==='CANCELLED')return;
        job.status=job.controller.signal.aborted?'CANCELLED':'FAILED';job.error={code:error?.code??'EXECUTION_FAILED',message:error?.message??String(error)};job.completedAt=now();
      }).finally(()=>{active.delete(id);void pump(userId);});
    }
  }

  return {
    async submit({userId,objective,logicalId=null,idempotencyKey=null}){
      if(!userId||!objective)throw new Error('userId and objective are required');
      const dedupeKey=idempotencyKey?`${userId}:${idempotencyKey}`:null;
      if(dedupeKey&&idempotency.has(dedupeKey)){const id=idempotency.get(dedupeKey);return {job:clone(jobs.get(id)),duplicate:true};}
      const id=idFactory();const job={id,userId,objective:clone(objective),logicalId:logicalId??id,status:'QUEUED',queuedAt:now(),startedAt:null,completedAt:null,result:null,error:null,metering:null,controller:new AbortController()};
      jobs.set(id,job);if(dedupeKey)idempotency.set(dedupeKey,id);queueFor(userId).push(id);void pump(userId);
      return {job:clone({...job,controller:undefined}),duplicate:false};
    },
    async cancel(id){
      const job=jobs.get(String(id));if(!job)return {cancelled:false,reason:'not-found'};
      if(['COMPLETED','FAILED','CANCELLED'].includes(job.status))return {cancelled:false,reason:'terminal',job:clone({...job,controller:undefined})};
      if(job.status==='QUEUED'){const q=queueFor(job.userId);const index=q.indexOf(job.id);if(index>=0)q.splice(index,1);}
      job.status='CANCELLED';job.completedAt=now();job.controller.abort();activeSet(job.userId).delete(job.id);void pump(job.userId);
      return {cancelled:true,job:clone({...job,controller:undefined})};
    },
    async get(id){const job=jobs.get(String(id));return job?clone({...job,controller:undefined}):null;},
    async list(userId){return [...jobs.values()].filter(j=>!userId||j.userId===userId).map(j=>clone({...j,controller:undefined}));},
    async status(userId){
      const rows=await this.list(userId);return {active:rows.filter(r=>r.status==='ACTIVE'),queued:rows.filter(r=>r.status==='QUEUED'),terminal:rows.filter(r=>['COMPLETED','FAILED','CANCELLED'].includes(r.status))};
    },
    async drain(userId,{timeoutMs=2000}={}){
      const started=Date.now();
      while(true){const s=await this.status(userId);if(!s.active.length&&!s.queued.length)return s;if(Date.now()-started>timeoutMs)throw new Error('parallel objective drain timeout');await new Promise(r=>setTimeout(r,5));}
    },
  };
}
