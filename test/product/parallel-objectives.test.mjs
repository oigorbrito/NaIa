import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createUsageMeter } from '../../src/product/metering.mjs';
import { createParallelObjectiveService } from '../../src/product/parallel-objectives.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

async function waitFor(fn,{timeout=1000}={}){const started=Date.now();while(true){const value=await fn();if(value)return value;if(Date.now()-started>timeout)throw new Error('wait timeout');await new Promise(r=>setTimeout(r,5));}}
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}

test('default plan concurrency limits are Free=1 Pro=2 Ultra=5',async()=>{
  const e=createEntitlementService();
  assert.equal((await e.limit('free','objectives.concurrent')).value,1);
  await e.setSubscription({userId:'pro',planId:'PRO'});
  await e.setSubscription({userId:'ultra',planId:'ULTRA'});
  assert.equal((await e.limit('pro','objectives.concurrent')).value,2);
  assert.equal((await e.limit('ultra','objectives.concurrent')).value,5);
});

test('two independent Pro objectives run in parallel while third is queued',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const gates=new Map();let running=0;let maxRunning=0;
  const executor={async run({objective}){running+=1;maxRunning=Math.max(maxRunning,running);const gate=deferred();gates.set(objective.id,gate);await gate.promise;running-=1;return {id:objective.id};}};
  let id=0;const service=createParallelObjectiveService({entitlements,executor,idFactory:()=>`job-${++id}`});
  const a=await service.submit({userId:'u1',objective:{id:'a'}});const b=await service.submit({userId:'u1',objective:{id:'b'}});const c=await service.submit({userId:'u1',objective:{id:'c'}});
  await waitFor(async()=>{const s=await service.status('u1');return s.active.length===2&&s.queued.length===1?s:null;});
  assert.equal(maxRunning,2);
  gates.get('a').resolve();
  await waitFor(async()=>{const s=await service.status('u1');return s.active.some(x=>x.objective.id==='c')?s:null;});
  gates.get('b').resolve();gates.get('c').resolve();
  const done=await service.drain('u1');assert.equal(done.terminal.filter(x=>x.status==='COMPLETED').length,3);
  assert.ok(a.job.id&&b.job.id&&c.job.id);
});

test('Free plan applies backpressure with one active objective',async()=>{
  const entitlements=createEntitlementService();const gates=[];
  const executor={async run(){const gate=deferred();gates.push(gate);await gate.promise;return 'ok';}};
  const service=createParallelObjectiveService({entitlements,executor});
  await service.submit({userId:'u1',objective:{id:'a'}});await service.submit({userId:'u1',objective:{id:'b'}});
  const saturated=await waitFor(async()=>{const s=await service.status('u1');return s.active.length===1&&s.queued.length===1?s:null;});
  assert.equal(saturated.active.length,1);assert.equal(saturated.queued.length,1);
  gates[0].resolve();await waitFor(()=>Promise.resolve(gates.length===2));gates[1].resolve();await service.drain('u1');
});

test('cancelling one active objective aborts only that objective and frees a slot',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const seen=new Map();
  const executor={async run({objective,signal}){const gate=deferred();seen.set(objective.id,{gate,signal});return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{const e=new Error('aborted');e.code='ABORTED';reject(e);},{once:true});gate.promise.then(()=>resolve(objective.id),reject);});}};
  let i=0;const service=createParallelObjectiveService({entitlements,executor,idFactory:()=>`j${++i}`});
  const a=await service.submit({userId:'u1',objective:{id:'a'}});await service.submit({userId:'u1',objective:{id:'b'}});await service.submit({userId:'u1',objective:{id:'c'}});
  await waitFor(async()=>seen.has('a')&&seen.has('b'));
  const cancelled=await service.cancel(a.job.id);assert.equal(cancelled.cancelled,true);assert.equal(seen.get('a').signal.aborted,true);assert.equal(seen.get('b').signal.aborted,false);
  await waitFor(async()=>seen.has('c'));seen.get('b').gate.resolve();seen.get('c').gate.resolve();
  const done=await service.drain('u1');
  assert.equal(done.terminal.find(x=>x.objective.id==='a').status,'CANCELLED');
  assert.equal(done.terminal.find(x=>x.objective.id==='b').status,'COMPLETED');
});

test('duplicate idempotency key returns the same job and does not execute twice',async()=>{
  const entitlements=createEntitlementService();let calls=0;
  const service=createParallelObjectiveService({entitlements,executor:{async run(){calls+=1;return 'ok';}},idFactory:()=> 'job-1'});
  const first=await service.submit({userId:'u1',objective:{id:'a'},idempotencyKey:'same'});
  const duplicate=await service.submit({userId:'u1',objective:{id:'a-again'},idempotencyKey:'same'});
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.job.id,first.job.id);
  await service.drain('u1');assert.equal(calls,1);
});

test('metering counts each logical objective once under concurrency',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const meter=createUsageMeter({entitlements});
  const service=createParallelObjectiveService({entitlements,meter,executor:{async run(){return 'ok';}}});
  await Promise.all([
    service.submit({userId:'u1',objective:{id:'a'},logicalId:'a'}),
    service.submit({userId:'u1',objective:{id:'b'},logicalId:'b'}),
  ]);
  await service.drain('u1');
  const usage=await meter.inspect({userId:'u1',metric:'executions.daily',window:'DAY'});assert.equal(usage.used,2);
});

test('parallel scheduling does not bypass normal approval semantics',async()=>{
  const entitlements=createEntitlementService();await entitlements.setSubscription({userId:'u1',planId:'PRO'});
  const naia=createNaiaService(createInMemoryPorts());
  const executor={async run({objective}){return naia.pursueAction(objective);}};
  const service=createParallelObjectiveService({entitlements,executor});
  await Promise.all([
    service.submit({userId:'u1',objective:{title:'write one',action:{tool:'note.write',input:{name:'a',content:'1'},risk:'LOCAL_WRITE',requiresApproval:true}}}),
    service.submit({userId:'u1',objective:{title:'write two',action:{tool:'note.write',input:{name:'b',content:'2'},risk:'LOCAL_WRITE',requiresApproval:true}}}),
  ]);
  const done=await service.drain('u1');
  assert.equal(done.terminal.length,2);
  assert.ok(done.terminal.every(job=>job.status==='COMPLETED'));
  assert.ok(done.terminal.every(job=>job.result.objective.status==='WAITING_APPROVAL'));
});
