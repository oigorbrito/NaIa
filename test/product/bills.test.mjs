import assert from 'node:assert/strict';
import test from 'node:test';
import { addMonthsClamped, createBillService, createMemoryBillStore } from '../../src/product/bills.mjs';
import { createMemoryScheduler, createMemoryTaskStore, createTaskService } from '../../src/product/tasks.mjs';

function fixture() {
  const taskStore = createMemoryTaskStore();
  const scheduler = createMemoryScheduler();
  let taskId = 0;
  const taskService = createTaskService({ taskStore, store: taskStore, scheduler, idFactory: () => 'task-' + ++taskId, now: () => '2026-09-19T12:00:00.000Z' });
  const store = createMemoryBillStore();
  let billId = 0;
  const service = createBillService({ store, taskService, idFactory: () => 'bill-' + ++billId, now: () => '2026-09-19T12:00:00.000Z' });
  return { service, taskService, scheduler, store };
}

test('monthly recurrence clamps end-of-month dates deterministically', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2028-01-31', 1), '2028-02-29');
});

test('one-time bill creates lead-time reminder tasks', async () => {
  const { service, taskService } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'internet', dueDate: '2026-09-30', amount: 120, leadTimesDays: [7, 1, 0] });
  assert.equal(bill.occurrences.length, 1);
  assert.equal(bill.occurrences[0].reminderTaskIds.length, 3);
  assert.equal((await taskService.list('u1')).length, 3);
});

test('mark paid closes occurrence and schedules next monthly occurrence', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'rent', dueDate: '2026-09-30', recurrence: { kind: 'MONTHLY', interval: 1 }, leadTimesDays: [1] });
  const paid = await service.markPaid(bill.id);
  assert.equal(paid.occurrences[0].status, 'PAID');
  assert.equal(paid.nextDueDate, '2026-10-30');
  assert.equal(paid.occurrences[1].status, 'OPEN');
});

test('overdue status is explicit when due date passes unresolved', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'water', dueDate: '2026-09-18', leadTimesDays: [0] });
  const [refreshed] = await service.refreshStatuses({ userId: 'u1', asOf: '2026-09-19' });
  assert.equal(refreshed.id, bill.id);
  assert.equal(refreshed.occurrences[0].status, 'OVERDUE');
});

test('reschedule preserves completed history and replaces only current occurrence', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'insurance', dueDate: '2026-09-25', leadTimesDays: [3] });
  const moved = await service.reschedule(bill.id, '2026-09-28');
  assert.equal(moved.occurrences[0].status, 'RESCHEDULED');
  assert.equal(moved.occurrences[1].status, 'OPEN');
  assert.equal(moved.nextDueDate, '2026-09-28');
});

test('duplicate scheduler delivery does not duplicate bill reminder occurrence', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'phone', dueDate: '2026-09-29', leadTimesDays: [1] });
  const first = await service.deliverReminder({ billId: bill.id, dueDate: '2026-09-29', leadDays: 1 });
  const second = await service.deliverReminder({ billId: bill.id, dueDate: '2026-09-29', leadDays: 1 });
  assert.equal(first.delivered, true);
  assert.equal(second.delivered, false);
  assert.equal(second.duplicate, true);
});

test('skipped occurrence does not emit further reminders and advances recurrence', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'subscription', dueDate: '2026-09-27', recurrence: { kind: 'MONTHLY' }, leadTimesDays: [0] });
  const skipped = await service.skip(bill.id);
  assert.equal(skipped.occurrences[0].status, 'SKIPPED');
  assert.equal(skipped.nextDueDate, '2026-10-27');
  const oldDelivery = await service.deliverReminder({ billId: bill.id, dueDate: '2026-09-27', leadDays: 0 });
  assert.equal(oldDelivery.delivered, false);
});

test('overdue occurrence can still be marked paid and advance recurrence', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'electricity', dueDate: '2026-09-18', recurrence: { kind: 'MONTHLY' }, leadTimesDays: [0] });
  await service.refreshStatuses({ userId: 'u1', asOf: '2026-09-19' });
  const paid = await service.markPaid(bill.id);
  assert.equal(paid.occurrences[0].status, 'PAID');
  assert.equal(paid.nextDueDate, '2026-10-18');
});
