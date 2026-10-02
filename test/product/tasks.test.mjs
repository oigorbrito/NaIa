import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileTaskStore, createMemoryScheduler, createMemoryTaskStore, createTaskService, registerTaskCapabilities } from '../../src/product/tasks.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';

function fixture() {
  const store = createMemoryTaskStore();
  const scheduler = createMemoryScheduler();
  let id = 0;
  const service = createTaskService({
    store, scheduler, idFactory: () => 'task-' + ++id, now: () => '2026-09-19T12:00:00.000Z',
  });
  return { service, store, scheduler };
}

test('creates and lists a one-time reminder with transport state separated from user state', async () => {
  const { service } = fixture();
  const created = await service.create({ userId: 'u1', title: 'call dentist', schedule: { kind: 'ONCE', at: '2026-09-20T15:00:00-03:00' } });
  assert.equal(created.task.userState, 'ACTIVE');
  assert.equal((await service.list('u1')).length, 1);
  const transport = await service.schedulerState(created.task.id);
  assert.equal(transport.transportState, 'SCHEDULED');
});

test('creation is idempotent when idempotency key repeats', async () => {
  const { service } = fixture();
  const input = { userId: 'u1', title: 'pay rent', schedule: { kind: 'ONCE', at: '2026-09-21T10:00:00-03:00' }, idempotencyKey: 'msg-1' };
  const first = await service.create(input);
  const second = await service.create(input);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.task.id, first.task.id);
});

test('completing task cancels scheduler job without deleting task history', async () => {
  const { service } = fixture();
  const created = await service.create({ userId: 'u1', title: 'finish report', schedule: { kind: 'ONCE', at: '2026-09-20T10:00:00-03:00' } });
  const completed = await service.complete(created.task.id);
  assert.equal(completed.userState, 'COMPLETED');
  assert.equal((await service.get(created.task.id)).userState, 'COMPLETED');
  assert.equal((await service.schedulerState(created.task.id)).transportState, 'CANCELLED');
});

test('cancel and reschedule are explicit lifecycle operations', async () => {
  const { service } = fixture();
  const created = await service.create({ userId: 'u1', title: 'meeting', schedule: { kind: 'ONCE', at: '2026-09-20T10:00:00-03:00' } });
  const moved = await service.reschedule(created.task.id, { kind: 'ONCE', at: '2026-09-22T11:00:00-03:00' });
  assert.equal(moved.schedule.at, '2026-09-22T11:00:00-03:00');
  const cancelled = await service.cancel(created.task.id);
  assert.equal(cancelled.userState, 'CANCELLED');
  await assert.rejects(service.reschedule(created.task.id, { kind: 'ONCE', at: '2026-09-23T11:00:00-03:00' }), /only active task/);
});

test('recurring reminder preserves recurrence metadata and next-run hint', async () => {
  const { service } = fixture();
  const created = await service.create({
    userId: 'u1', title: 'weekly review',
    schedule: { kind: 'RECURRING', rrule: 'FREQ=WEEKLY;BYDAY=MO', nextRunAt: '2026-09-21T08:00:00-03:00' },
  });
  assert.deepEqual(created.task.schedule, { kind: 'RECURRING', rrule: 'FREQ=WEEKLY;BYDAY=MO', nextRunAt: '2026-09-21T08:00:00-03:00' });
});

test('duplicate scheduler delivery does not duplicate reminder action', async () => {
  const { service } = fixture();
  const created = await service.create({ userId: 'u1', title: 'drink water', schedule: { kind: 'ONCE', at: '2026-09-20T09:00:00-03:00' } });
  const first = await service.deliver({ taskId: created.task.id, occurrenceKey: '2026-09-20T09:00' });
  const duplicate = await service.deliver({ taskId: created.task.id, occurrenceKey: '2026-09-20T09:00' });
  assert.equal(first.delivered, true);
  assert.equal(duplicate.delivered, false);
  assert.equal(duplicate.duplicate, true);
});

test('task creation registers through NaIA approval policy instead of bypassing it', () => {
  const { service } = fixture();
  const definitions = new Map();
  const naia = { registerCapability(value) { definitions.set(value.name, value); return { name: value.name, risk: value.tool.risk }; } };
  const [registered] = registerTaskCapabilities(naia, { service, userId: 'u1' });
  assert.deepEqual(registered, { name: 'task.reminder.create', risk: 'LOCAL_WRITE' });
  const action = definitions.get('task.reminder.create').rule.action({ id: 'objective-1', title: 'remind me tomorrow: call dentist' });
  assert.equal(action.requiresApproval, true);
  assert.equal(action.risk, 'LOCAL_WRITE');
});

test('file-backed tasks and delivery idempotency survive restart', async () => {
  const dir=await mkdtemp(join(tmpdir(),'naia-tasks-'));
  try {
    const scheduler=createMemoryScheduler();
    let id=0;
    const first=createTaskService({store:createFileTaskStore({rootDir:dir}),scheduler,idFactory:()=>`task-${++id}`,now:()=> '2026-09-19T12:00:00Z'});
    const created=await first.create({userId:'u1',title:'call dentist',schedule:{kind:'ONCE',at:'2026-09-20T15:00:00-03:00'},idempotencyKey:'msg-1'});
    const delivery=await first.deliver({taskId:created.task.id,occurrenceKey:'2026-09-20T15:00'});
    assert.equal(delivery.delivered,true);
    const second=createTaskService({store:createFileTaskStore({rootDir:dir}),scheduler,now:()=> '2026-09-19T13:00:00Z'});
    assert.equal((await second.get(created.task.id)).title,'call dentist');
    const duplicateCreate=await second.create({userId:'u1',title:'call dentist',schedule:{kind:'ONCE',at:'2026-09-20T15:00:00-03:00'},idempotencyKey:'msg-1'});
    assert.equal(duplicateCreate.duplicate,true);
    const duplicateDelivery=await second.deliver({taskId:created.task.id,occurrenceKey:'2026-09-20T15:00'});
    assert.equal(duplicateDelivery.duplicate,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('recurring delivery advances nextRunAt using scheduler-provided next occurrence', async () => {
  const { service }=fixture();
  const created=await service.create({userId:'u1',title:'weekly review',schedule:{kind:'RECURRING',rrule:'FREQ=WEEKLY;BYDAY=MO',nextRunAt:'2026-09-21T08:00:00-03:00'}});
  const delivered=await service.deliver({taskId:created.task.id,occurrenceKey:'2026-09-21T08:00',nextRunAt:'2026-09-28T08:00:00-03:00'});
  assert.equal(delivered.delivered,true);
  assert.equal(delivered.task.schedule.nextRunAt,'2026-09-28T08:00:00-03:00');
});

test('all task lifecycle capabilities preserve sensitive-read/write approval boundaries', async () => {
  const { service }=fixture();
  const naia=createNaiaService(createInMemoryPorts());
  registerTaskCapabilities(naia,{service,userId:'u1'});
  const create=await naia.pursueAction({title:'Create task',action:{tool:'task.reminder.create',input:{title:'call dentist',schedule:{kind:'ONCE',at:'2026-09-20T15:00:00-03:00'}},risk:'LOCAL_WRITE',requiresApproval:true}});
  assert.equal(create.objective.status,'WAITING_APPROVAL');
  const completedCreate=await naia.approve(create.objective.id,'task.reminder.create');
  assert.equal(completedCreate.objective.status,'COMPLETED');
  const [task]=await service.list('u1');
  const read=await naia.pursueAction({title:'List tasks',action:{tool:'task.list',input:{},risk:'SENSITIVE',requiresApproval:true}});
  assert.equal(read.objective.status,'WAITING_APPROVAL');
  for (const tool of ['task.complete','task.cancel','task.reschedule']) {
    const input=tool==='task.reschedule'?{taskId:task.id,schedule:{kind:'ONCE',at:'2026-09-21T15:00:00-03:00'}}:{taskId:task.id};
    const pending=await naia.pursueAction({title:tool,action:{tool,input,risk:'LOCAL_WRITE',requiresApproval:true}});
    assert.equal(pending.objective.status,'WAITING_APPROVAL');
  }
});

test('task get and lifecycle operations cannot cross user boundary', async () => {
  const { service }=fixture();
  const created=await service.create({userId:'u1',title:'private task',schedule:{kind:'ONCE',at:'2026-09-20T15:00:00-03:00'}});
  const ports=createInMemoryPorts();
  const naia=createNaiaService(ports);
  registerTaskCapabilities(naia,{service,userId:'u2'});
  const getPending=await naia.pursueAction({title:'Get task',action:{tool:'task.get',input:{taskId:created.task.id},risk:'SENSITIVE',requiresApproval:true}});
  const read=await naia.approve(getPending.objective.id,'task.get');
  assert.equal(read.objective.status,'COMPLETED');
  const readEvidence=await ports.evidence.list({objectiveId:read.objective.id});
  const readExecution=readEvidence.find((row)=>row.type==='STEP_EXECUTED'&&row.tool==='task.get');
  assert.equal(readExecution.output.result,null);
  const pending=await naia.pursueAction({title:'Complete other task',action:{tool:'task.complete',input:{taskId:created.task.id},risk:'LOCAL_WRITE',requiresApproval:true}});
  const blocked=await naia.approve(pending.objective.id,'task.complete');
  assert.equal(blocked.objective.status,'FAILED');
  assert.equal((await service.get(created.task.id)).userState,'ACTIVE');
});
