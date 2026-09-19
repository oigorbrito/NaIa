import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontendApi } from '../../src/product/frontend-api.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/in-memory-ports.mjs';
import { createTaskService } from '../../src/product/tasks.mjs';
import { createEntitlementService } from '../../src/product/entitlements.mjs';
import { createUsageMeter } from '../../src/product/metering.mjs';

function fixture() {
  const naia = createNaiaService(createInMemoryPorts());
  const tasks = createTaskService({ idFactory: (() => { let i=0; return () => 'task-'+(++i); })(), now: () => '2026-09-19T13:00:00.000Z' });
  const entitlements = createEntitlementService();
  const meter = createUsageMeter({ entitlements, now: () => new Date('2026-09-19T13:00:00Z') });
  const api = createFrontendApi({ naia, userId: 'u1', tasks, entitlements, meter });
  return { naia, tasks, entitlements, meter, api };
}

test('submit returns end-to-end objective view for completed read-only request', async () => {
  const { api } = fixture();
  const result = await api.submit({ text: 'uppercase: hello' });
  assert.equal(result.ok, true);
  assert.equal(result.objective.status, 'COMPLETED');
  assert.equal(result.objective.steps.length, 3);
  assert.ok(result.objective.evidence.some((row)=>row.type==='OBJECTIVE_COMPLETED'));
});

test('write request surfaces WAITING_APPROVAL and approval inbox without bypassing policy', async () => {
  const { api } = fixture();
  const result = await api.submit({ text: 'note release: ship it' });
  assert.equal(result.ok, true);
  assert.equal(result.objective.status, 'WAITING_APPROVAL');
  assert.equal(result.objective.pendingApprovals.length, 1);
  assert.equal(result.objective.pendingApprovals[0].tool, 'note.write');
  const inbox = await api.approvals();
  assert.equal(inbox.ok, true);
  assert.equal(inbox.approvals.length, 1);
  assert.deepEqual(inbox.confirmations, []);
});

test('frontend approve delegates to runtime and returns completed objective', async () => {
  const { api } = fixture();
  const pending = await api.submit({ text: 'note release: ship it' });
  const approved = await api.approve({ objectiveId: pending.objective.id, tool: 'note.write' });
  assert.equal(approved.ok, true);
  assert.equal(approved.objective.status, 'COMPLETED');
});

test('objective lookup and history expose stable user-facing views', async () => {
  const { api } = fixture();
  const created = await api.submit({ text: 'uppercase: persisted' });
  const snapshot = await api.objective(created.objective.id);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.objective.id, created.objective.id);
  const history = await api.history();
  assert.equal(history.ok, true);
  assert.equal(history.objectives[0].id, created.objective.id);
});

test('automations surface task state and cancel operation through task service', async () => {
  const { api, tasks } = fixture();
  const created = await tasks.create({ userId:'u1', title:'drink water', schedule:{kind:'ONCE',at:'2026-09-20T09:00:00-03:00'} });
  const list = await api.automations();
  assert.equal(list.ok,true);
  assert.equal(list.available,true);
  assert.equal(list.items.length,1);
  const cancelled = await api.cancelAutomation(created.task.id);
  assert.equal(cancelled.ok,true);
  assert.equal(cancelled.item.userState,'CANCELLED');
});

test('premium state exposes plan and remaining quota without billing-provider coupling', async () => {
  const { api, entitlements, meter } = fixture();
  await entitlements.setSubscription({userId:'u1',planId:'PRO',state:'ACTIVE'});
  await meter.consume({userId:'u1',metric:'executions.daily',window:'DAY',logicalId:'run-1'});
  const premium = await api.premiumState();
  assert.equal(premium.ok,true);
  assert.equal(premium.plan.id,'PRO');
  const daily = premium.usage.find((row)=>row.metric==='executions.daily');
  assert.equal(daily.used,1);
  assert.equal(daily.remaining,249);
});

test('shell aggregates core product surfaces and marks optional connector surface unavailable cleanly', async () => {
  const { api } = fixture();
  const shell = await api.shell();
  assert.equal(shell.ok,true);
  assert.ok(shell.navigation.includes('chat'));
  assert.ok(shell.navigation.includes('approvals'));
  assert.equal(shell.surfaces.connectors.available,false);
});

test('API normalizes runtime errors into stable client payloads', async () => {
  const brokenNaia = {
    async pursue(){ const error=new Error('offline'); error.code='OFFLINE'; error.retryable=true; throw error; },
    async get(){ return {objective:null,plan:null,evidence:[]}; },
    async history(){ return []; },
  };
  const api=createFrontendApi({naia:brokenNaia,userId:'u1'});
  const result=await api.submit({text:'hello'});
  assert.deepEqual(result,{ok:false,error:{code:'OFFLINE',message:'offline',retryable:true}});
});
