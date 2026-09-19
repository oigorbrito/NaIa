import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { addMonthsClamped, createBillService, createFileBillStore, createMemoryBillStore, registerBillCapabilities } from '../../src/product/bills.mjs';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import { createFrontendApi } from '../../src/product/frontend-api.mjs';
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

test('editing amount and recurrence preserves resolved history while updating future state', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'rent', dueDate: '2026-09-30', amount: 1000, recurrence: { kind: 'MONTHLY' }, leadTimesDays: [1] });
  const paid = await service.markPaid(bill.id);
  assert.equal(paid.occurrences[0].status, 'PAID');
  const updated = await service.update(bill.id, { amount: 1100, recurrence: null });
  assert.equal(updated.amount, 1100);
  assert.equal(updated.recurrence, null);
  assert.equal(updated.occurrences[0].status, 'PAID');
  assert.equal(updated.occurrences[0].dueDate, '2026-09-30');
  assert.equal(updated.nextDueDate, '2026-10-30');
});

test('editing next due date and lead times replaces only the open future occurrence', async () => {
  const { service, taskService } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'internet', dueDate: '2026-09-30', amount: 100, recurrence: { kind: 'MONTHLY' }, leadTimesDays: [7, 1] });
  const paid = await service.markPaid(bill.id);
  const oldFuture = paid.occurrences[1];
  const updated = await service.update(bill.id, { nextDueDate: '2026-10-28', leadTimesDays: [3, 0], amount: 120 });
  assert.equal(updated.occurrences[0].status, 'PAID');
  assert.equal(updated.occurrences[1].dueDate, oldFuture.dueDate);
  assert.equal(updated.occurrences[1].status, 'RESCHEDULED');
  assert.equal(updated.occurrences[2].dueDate, '2026-10-28');
  assert.equal(updated.occurrences[2].status, 'OPEN');
  assert.equal(updated.occurrences[2].reminderTaskIds.length, 2);
  assert.equal(updated.amount, 120);
  const tasks = await taskService.list('u1');
  const active = tasks.filter((task) => task.userState === 'ACTIVE');
  assert.equal(active.length, 2);
});

test('upcoming view exposes source and ordered current bill occurrences', async () => {
  const { service } = fixture();
  await service.create({ userId: 'u1', name: 'water', dueDate: '2026-09-25', amount: 80, source: { kind: 'MANUAL' }, leadTimesDays: [0] });
  await service.create({ userId: 'u1', name: 'internet', dueDate: '2026-09-22', amount: 120, source: { kind: 'INVOICE', id: 'doc-1' }, leadTimesDays: [0] });
  const rows = await service.upcoming({ userId: 'u1', asOf: '2026-09-19', days: 10 });
  assert.deepEqual(rows.map((row) => row.name), ['internet', 'water']);
  assert.equal(rows[0].source.id, 'doc-1');
  assert.equal(rows[0].amount, 120);
});

test('overdue occurrence reminder can be delivered once and remains idempotent', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId: 'u1', name: 'electricity', dueDate: '2026-09-18', amount: 90, leadTimesDays: [0] });
  await service.refreshStatuses({ userId: 'u1', asOf: '2026-09-19' });
  const first = await service.deliverReminder({ billId: bill.id, dueDate: '2026-09-18', leadDays: 0 });
  const second = await service.deliverReminder({ billId: bill.id, dueDate: '2026-09-18', leadDays: 0 });
  assert.equal(first.delivered, true);
  assert.equal(first.amount, 90);
  assert.equal(second.duplicate, true);
});

test('file-backed bill store preserves bills and reminder delivery deduplication across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naia-bills-'));
  try {
    const taskStore = createMemoryTaskStore();
    const scheduler = createMemoryScheduler();
    const taskService = createTaskService({ store: taskStore, scheduler, idFactory: (() => { let i = 0; return () => 'task-' + ++i; })(), now: () => '2026-09-19T12:00:00.000Z' });
    const first = createBillService({ store: createFileBillStore({ rootDir: dir }), taskService, idFactory: () => 'bill-1', now: () => '2026-09-19T12:00:00.000Z' });
    const bill = await first.create({ userId: 'u1', name: 'phone', dueDate: '2026-09-29', leadTimesDays: [1] });
    await first.deliverReminder({ billId: bill.id, dueDate: '2026-09-29', leadDays: 1 });
    const second = createBillService({ store: createFileBillStore({ rootDir: dir }), taskService, now: () => '2026-09-19T13:00:00.000Z' });
    assert.equal((await second.get('bill-1')).name, 'phone');
    const duplicate = await second.deliverReminder({ billId: 'bill-1', dueDate: '2026-09-29', leadDays: 1 });
    assert.equal(duplicate.duplicate, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generic runtime bill writes remain approval-gated and reads remain sensitive', async () => {
  const { service } = fixture();
  const naia = createNaiaService(createInMemoryPorts());
  registerBillCapabilities(naia, { service, userId: 'u1' });
  const create = await naia.pursueAction({
    title: 'Create bill reminder',
    action: { tool:'bill.create', input:{ name:'internet', dueDate:'2026-09-30', amount:120, leadTimesDays:[1] }, risk:'LOCAL_WRITE', requiresApproval:true },
  });
  assert.equal(create.objective.status, 'WAITING_APPROVAL');
  assert.equal((await service.list('u1')).length, 0);
  await naia.approve(create.objective.id, 'bill.create');
  assert.equal((await service.list('u1')).length, 1);
  const read = await naia.pursueAction({
    title: 'List bills',
    action: { tool:'bill.list', input:{ asOf:'2026-09-19', days:30 }, risk:'SENSITIVE', requiresApproval:true },
  });
  assert.equal(read.objective.status, 'WAITING_APPROVAL');
});

test('mark-paid runtime capability never performs a payment and only changes reminder state', async () => {
  const { service } = fixture();
  const bill = await service.create({ userId:'u1', name:'rent', dueDate:'2026-09-30', amount:1000, leadTimesDays:[0] });
  const naia = createNaiaService(createInMemoryPorts());
  registerBillCapabilities(naia, { service, userId:'u1' });
  const pending = await naia.pursueAction({
    title:'Mark bill paid',
    action:{ tool:'bill.markPaid', input:{ billId:bill.id }, risk:'LOCAL_WRITE', requiresApproval:true },
  });
  assert.equal(pending.objective.status,'WAITING_APPROVAL');
  await naia.approve(pending.objective.id,'bill.markPaid');
  const updated = await service.get(bill.id);
  assert.equal(updated.occurrences[0].status,'PAID');
  assert.equal('paymentId' in updated,false);
});

test('frontend bill surface exposes upcoming and overdue states without requiring a dedicated client implementation', async () => {
  const { service } = fixture();
  await service.create({ userId:'u1', name:'internet', dueDate:'2026-09-25', amount:120, leadTimesDays:[0] });
  await service.create({ userId:'u1', name:'water', dueDate:'2026-09-18', amount:80, leadTimesDays:[0] });
  const fakeNaia = { async pursue(){}, async get(){ return { objective:null }; }, async history(){ return []; }, async approve(){}, async resume(){} };
  const api = createFrontendApi({ naia:fakeNaia, userId:'u1', bills:service });
  const state = await api.billState({ asOf:'2026-09-19', days:30 });
  assert.equal(state.ok,true);
  assert.equal(state.available,true);
  assert.deepEqual(state.items.map((row)=>row.name),['internet']);
  assert.deepEqual(state.overdue.map((row)=>row.name),['water']);
});
