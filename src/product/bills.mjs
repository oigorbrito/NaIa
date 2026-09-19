import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

function clone(value) { return structuredClone(value); }
function dateOnly(value) { return String(value).slice(0, 10); }
function parseDate(value) { const date = new Date(value + (String(value).length === 10 ? 'T12:00:00Z' : '')); if (Number.isNaN(date.getTime())) throw new Error('invalid date: ' + value); return date; }
function isoDate(date) { return date.toISOString().slice(0, 10); }

export function addMonthsClamped(dateValue, months = 1) {
  const source = parseDate(dateValue);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoDate(target);
}

export function createMemoryBillStore() {
  const bills = new Map();
  const occurrenceDeliveries = new Set();
  return {
    async save(bill) { bills.set(bill.id, clone(bill)); return clone(bill); },
    async get(id) { const value = bills.get(id); return value ? clone(value) : null; },
    async list({ userId } = {}) { return [...bills.values()].filter((bill) => !userId || bill.userId === userId).map(clone); },
    async recordDelivery(key) { if (occurrenceDeliveries.has(key)) return false; occurrenceDeliveries.add(key); return true; },
  };
}

async function readBillJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { bills: {}, deliveries: {} }; throw error; }
}
async function writeBillJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileBillStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'bills.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(() => {}).then(async () => {
      const data = await readBillJson(path);
      const result = await fn(data);
      await writeBillJsonAtomic(path, data);
      return clone(result);
    });
    return chain;
  }
  return {
    path,
    async save(bill) { return mutate((data) => { data.bills[bill.id] = clone(bill); return bill; }); },
    async get(id) { const data = await readBillJson(path); return data.bills?.[String(id)] ? clone(data.bills[String(id)]) : null; },
    async list({ userId } = {}) { const data = await readBillJson(path); return Object.values(data.bills ?? {}).filter((bill) => !userId || bill.userId === userId).map(clone); },
    async recordDelivery(key) { return mutate((data) => { if (data.deliveries[key]) return false; data.deliveries[key] = true; return true; }); },
  };
}

function normalizeLeadTimes(value = [7, 3, 1, 0]) {
  return [...new Set(value.map(Number).filter((days) => Number.isInteger(days) && days >= 0))].sort((a, b) => b - a);
}

function currentOccurrence(bill) {
  return bill.occurrences.find((item) => item.dueDate === bill.nextDueDate && ['OPEN', 'OVERDUE'].includes(item.status)) ?? null;
}

export function createBillService({ store = createMemoryBillStore(), taskService, idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
  if (!taskService || typeof taskService.create !== 'function') throw new Error('taskService is required');

  async function scheduleOccurrence(bill, dueDate) {
    const occurrence = { dueDate, status: 'OPEN', resolvedAt: null, reminderTaskIds: [] };
    for (const leadDays of bill.leadTimesDays) {
      const due = parseDate(dueDate);
      due.setUTCDate(due.getUTCDate() - leadDays);
      const created = await taskService.create({
        userId: bill.userId,
        title: bill.name + ' due ' + dueDate + (leadDays ? ' (' + leadDays + 'd)' : ''),
        schedule: { kind: 'ONCE', at: isoDate(due) + 'T09:00:00-03:00' },
        idempotencyKey: 'bill:' + bill.id + ':' + dueDate + ':lead:' + leadDays,
      });
      occurrence.reminderTaskIds.push(created.task.id);
    }
    bill.occurrences.push(occurrence);
    bill.nextDueDate = dueDate;
  }

  async function requireBill(id) {
    const bill = await store.get(id);
    if (!bill) throw new Error('bill not found: ' + id);
    return bill;
  }

  async function closeOccurrence(bill, status) {
    const occurrence = currentOccurrence(bill);
    if (!occurrence) throw new Error('no open bill occurrence');
    occurrence.status = status;
    occurrence.resolvedAt = now();
    for (const taskId of occurrence.reminderTaskIds) {
      if (status === 'PAID') await taskService.complete(taskId);
      else await taskService.cancel(taskId);
    }
    if (bill.recurrence?.kind === 'MONTHLY') {
      await scheduleOccurrence(bill, addMonthsClamped(occurrence.dueDate, bill.recurrence.interval ?? 1));
    } else bill.nextDueDate = null;
    bill.updatedAt = now();
    await store.save(bill);
    return clone(bill);
  }

  return {
    async create({ userId, name, dueDate, amount = null, currency = 'BRL', recurrence = null, leadTimesDays = [7, 3, 1, 0], source = null }) {
      if (!userId || !String(name ?? '').trim()) throw new Error('userId and name are required');
      parseDate(dueDate);
      const bill = {
        id: idFactory(), userId, name: String(name).trim(),
        amount: amount == null ? null : Number(amount), currency: String(currency).toUpperCase(),
        recurrence: recurrence ? clone(recurrence) : null,
        leadTimesDays: normalizeLeadTimes(leadTimesDays), source: clone(source),
        nextDueDate: null, occurrences: [], createdAt: now(), updatedAt: now(),
      };
      if (bill.recurrence && bill.recurrence.kind !== 'MONTHLY') throw new Error('unsupported bill recurrence');
      await scheduleOccurrence(bill, dateOnly(dueDate));
      await store.save(bill);
      return clone(bill);
    },

    async get(id) { return requireBill(id); },
    async list(userId) { return store.list({ userId }); },

    async markPaid(id) { return closeOccurrence(await requireBill(id), 'PAID'); },
    async skip(id) { return closeOccurrence(await requireBill(id), 'SKIPPED'); },

    async refreshStatuses({ userId, asOf = dateOnly(now()) }) {
      const bills = await store.list({ userId });
      for (const bill of bills) {
        const occurrence = currentOccurrence(bill);
        if (occurrence && occurrence.dueDate < asOf) occurrence.status = 'OVERDUE';
        await store.save(bill);
      }
      return store.list({ userId });
    },

    async reschedule(id, dueDate) {
      const bill = await requireBill(id);
      parseDate(dueDate);
      const occurrence = currentOccurrence(bill);
      if (!occurrence) throw new Error('no open bill occurrence');
      for (const taskId of occurrence.reminderTaskIds) await taskService.cancel(taskId);
      occurrence.status = 'RESCHEDULED';
      occurrence.resolvedAt = now();
      await scheduleOccurrence(bill, dateOnly(dueDate));
      bill.updatedAt = now();
      await store.save(bill);
      return clone(bill);
    },

    async update(id, { name, amount, currency, recurrence, leadTimesDays, nextDueDate } = {}) {
      const bill = await requireBill(id);
      const occurrence = currentOccurrence(bill);
      const requiresReschedule = nextDueDate !== undefined || leadTimesDays !== undefined;
      if (name !== undefined && String(name).trim()) bill.name = String(name).trim();
      if (amount !== undefined) bill.amount = amount == null ? null : Number(amount);
      if (currency !== undefined) bill.currency = String(currency).toUpperCase();
      if (recurrence !== undefined) {
        if (recurrence && recurrence.kind !== 'MONTHLY') throw new Error('unsupported bill recurrence');
        bill.recurrence = recurrence ? clone(recurrence) : null;
      }
      if (leadTimesDays !== undefined) bill.leadTimesDays = normalizeLeadTimes(leadTimesDays);
      if (requiresReschedule) {
        if (!occurrence) throw new Error('no open bill occurrence');
        const targetDate = dateOnly(nextDueDate ?? occurrence.dueDate);
        parseDate(targetDate);
        for (const taskId of occurrence.reminderTaskIds) await taskService.cancel(taskId);
        occurrence.status = 'RESCHEDULED';
        occurrence.resolvedAt = now();
        await scheduleOccurrence(bill, targetDate);
      }
      bill.updatedAt = now();
      await store.save(bill);
      return clone(bill);
    },

    async upcoming({ userId, asOf = dateOnly(now()), days = 30 }) {
      const start = parseDate(asOf).getTime();
      const end = start + Number(days) * 24 * 60 * 60 * 1000;
      return (await store.list({ userId }))
        .map((bill) => ({ bill, occurrence: currentOccurrence(bill) }))
        .filter(({ occurrence }) => occurrence)
        .filter(({ occurrence }) => { const due = parseDate(occurrence.dueDate).getTime(); return due >= start && due <= end; })
        .sort((a, b) => a.occurrence.dueDate.localeCompare(b.occurrence.dueDate))
        .map(({ bill, occurrence }) => ({
          billId: bill.id, name: bill.name, dueDate: occurrence.dueDate, status: occurrence.status,
          amount: bill.amount, currency: bill.currency, source: clone(bill.source),
        }));
    },

    async deliverReminder({ billId, dueDate, leadDays }) {
      const bill = await requireBill(billId);
      const occurrence = bill.occurrences.find((item) => item.dueDate === dueDate);
      if (!occurrence || !['OPEN', 'OVERDUE'].includes(occurrence.status)) return { delivered: false, reason: 'inactive-occurrence' };
      const key = bill.id + ':' + dueDate + ':' + Number(leadDays);
      if (!(await store.recordDelivery(key))) return { delivered: false, duplicate: true };
      return { delivered: true, duplicate: false, billId: bill.id, dueDate, leadDays: Number(leadDays), amount: bill.amount, currency: bill.currency, source: clone(bill.source) };
    },
  };
}
