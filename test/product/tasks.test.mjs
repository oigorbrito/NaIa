import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryScheduler, createMemoryTaskStore, createTaskService, registerTaskCapabilities } from '../../src/product/tasks.mjs';

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
  let definition;
  const naia = { registerCapability(value) { definition = value; return { name: value.name, risk: value.tool.risk }; } };
  const [registered] = registerTaskCapabilities(naia, { service, userId: 'u1' });
  assert.deepEqual(registered, { name: 'task.reminder.create', risk: 'LOCAL_WRITE' });
  const action = definition.rule.action({ id: 'objective-1', title: 'remind me tomorrow: call dentist' });
  assert.equal(action.requiresApproval, true);
  assert.equal(action.risk, 'LOCAL_WRITE');
});
