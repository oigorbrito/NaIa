import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const USER_STATES = new Set(['ACTIVE', 'COMPLETED', 'CANCELLED']);

function clone(value) { return structuredClone(value); }
function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') throw new Error('schedule is required');
  const kind = String(schedule.kind ?? '').toUpperCase();
  if (kind === 'ONCE') {
    if (!schedule.at) throw new Error('one-time schedule requires at');
    return { kind, at: String(schedule.at) };
  }
  if (kind === 'RECURRING') {
    if (!schedule.rrule) throw new Error('recurring schedule requires rrule');
    return { kind, rrule: String(schedule.rrule), nextRunAt: schedule.nextRunAt ? String(schedule.nextRunAt) : null };
  }
  throw new Error('unsupported schedule kind: ' + kind);
}

export function createMemoryTaskStore() {
  const tasks = new Map();
  const deliveryKeys = new Set();
  return {
    async save(task) { tasks.set(task.id, clone(task)); return clone(task); },
    async get(id) { const value = tasks.get(id); return value ? clone(value) : null; },
    async list({ userId } = {}) { return [...tasks.values()].filter((task) => !userId || task.userId === userId).map(clone); },
    async recordDelivery(key) { if (deliveryKeys.has(key)) return false; deliveryKeys.add(key); return true; },
    async hasDelivery(key) { return deliveryKeys.has(key); },
  };
}

async function readTaskJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return { tasks:{}, deliveries:{} }; throw error; }
}
async function writeTaskJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive:true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function createFileTaskStore({ rootDir = '.naia' } = {}) {
  const path = join(rootDir, 'tasks.json');
  let chain = Promise.resolve();
  async function mutate(fn) {
    chain = chain.catch(()=>{}).then(async()=>{ const data=await readTaskJson(path); const result=await fn(data); await writeTaskJsonAtomic(path,data); return clone(result); });
    return chain;
  }
  return {
    path,
    async save(task) { return mutate((data)=>{ data.tasks[task.id]=clone(task); return task; }); },
    async get(id) { const data=await readTaskJson(path); return data.tasks?.[String(id)] ? clone(data.tasks[String(id)]) : null; },
    async list({ userId } = {}) { const data=await readTaskJson(path); return Object.values(data.tasks??{}).filter((task)=>!userId||task.userId===userId).map(clone); },
    async recordDelivery(key) { return mutate((data)=>{ if(data.deliveries[key]) return false; data.deliveries[key]=true; return true; }); },
    async hasDelivery(key) { const data=await readTaskJson(path); return Boolean(data.deliveries?.[key]); },
  };
}

export function createMemoryScheduler() {
  const jobs = new Map();
  return {
    async schedule(job) { jobs.set(job.id, clone(job)); return clone(job); },
    async cancel(id) { const job = jobs.get(id); if (!job) return false; job.transportState = 'CANCELLED'; jobs.set(id, job); return true; },
    async get(id) { const value = jobs.get(id); return value ? clone(value) : null; },
    async list() { return [...jobs.values()].map(clone); },
  };
}

export function createTaskService({
  store = createMemoryTaskStore(),
  scheduler = createMemoryScheduler(),
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  async function requireTask(id) {
    const task = await store.get(id);
    if (!task) throw new Error('task not found: ' + id);
    return task;
  }

  async function syncSchedule(task) {
    if (task.userState !== 'ACTIVE') return null;
    return scheduler.schedule({
      id: task.schedulerJobId,
      taskId: task.id,
      schedule: clone(task.schedule),
      transportState: 'SCHEDULED',
    });
  }

  return {
    async create({ userId, title, schedule, idempotencyKey = null }) {
      if (!userId) throw new Error('userId is required');
      if (!String(title ?? '').trim()) throw new Error('title is required');
      if (idempotencyKey) {
        const existing = (await store.list({ userId })).find((task) => task.idempotencyKey === idempotencyKey);
        if (existing) return { task: existing, duplicate: true };
      }
      const id = idFactory();
      const task = {
        id,
        userId,
        title: String(title).trim(),
        schedule: normalizeSchedule(schedule),
        userState: 'ACTIVE',
        schedulerJobId: 'task:' + id,
        idempotencyKey,
        lastDeliveredAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      await store.save(task);
      await syncSchedule(task);
      return { task: clone(task), duplicate: false };
    },

    async list(userId) { return store.list({ userId }); },
    async get(id) { return requireTask(id); },

    async complete(id) {
      const task = await requireTask(id);
      task.userState = 'COMPLETED';
      task.updatedAt = now();
      await store.save(task);
      await scheduler.cancel(task.schedulerJobId);
      return clone(task);
    },

    async cancel(id) {
      const task = await requireTask(id);
      task.userState = 'CANCELLED';
      task.updatedAt = now();
      await store.save(task);
      await scheduler.cancel(task.schedulerJobId);
      return clone(task);
    },

    async reschedule(id, schedule) {
      const task = await requireTask(id);
      if (!USER_STATES.has(task.userState) || task.userState !== 'ACTIVE') throw new Error('only active task can be rescheduled');
      task.schedule = normalizeSchedule(schedule);
      task.updatedAt = now();
      await store.save(task);
      await syncSchedule(task);
      return clone(task);
    },

    async deliver({ taskId, occurrenceKey, nextRunAt = null }) {
      const task = await requireTask(taskId);
      if (task.userState !== 'ACTIVE') return { delivered: false, reason: 'inactive-task', task: clone(task) };
      if (!occurrenceKey) throw new Error('occurrenceKey is required');
      const deliveryKey = task.id + ':' + occurrenceKey;
      if (!(await store.recordDelivery(deliveryKey))) return { delivered: false, duplicate: true, task: clone(task) };
      task.lastDeliveredAt = now();
      if (task.schedule.kind === 'RECURRING' && nextRunAt) task.schedule.nextRunAt = String(nextRunAt);
      task.updatedAt = task.lastDeliveredAt;
      await store.save(task);
      return { delivered: true, duplicate: false, task: clone(task) };
    },

    async schedulerState(id) {
      const task = await requireTask(id);
      return scheduler.get(task.schedulerJobId);
    },
  };
}

export function registerTaskCapabilities(naia, { service, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || !userId) throw new Error('task service and userId are required');
  return [
    naia.registerCapability({
      name: 'task.reminder.create',
      tool: { risk: 'LOCAL_WRITE', capability: 'tasks.reminders', description: 'Creates a persisted task/reminder', async run(input) { return service.create({ userId, ...input }); } },
      rule: {
        name: 'task-reminder-create',
        match: ({ title }) => /^remind me|^lembre-me|^me lembre/i.test(String(title ?? '').trim()),
        action: ({ title, id }) => ({ tool:'task.reminder.create', input:{ title:String(title), schedule:{ kind:'ONCE', at:'UNRESOLVED' }, idempotencyKey:id }, risk:'LOCAL_WRITE', requiresApproval:true }),
      },
    }),
    naia.registerCapability({ name:'task.list', tool:{ risk:'SENSITIVE', capability:'tasks.reminders', description:'Lists personal tasks/reminders', async run(){ return service.list(userId); } } }),
    naia.registerCapability({ name:'task.get', tool:{ risk:'SENSITIVE', capability:'tasks.reminders', description:'Reads one personal task/reminder', async run(input){ const task=await service.get(input.taskId); if(task.userId!==userId) return null; return task; } } }),
    naia.registerCapability({ name:'task.complete', tool:{ risk:'LOCAL_WRITE', capability:'tasks.reminders', description:'Completes a task/reminder', async run(input){ const task=await service.get(input.taskId); if(task.userId!==userId) throw new Error('task not found'); return service.complete(input.taskId); } } }),
    naia.registerCapability({ name:'task.cancel', tool:{ risk:'LOCAL_WRITE', capability:'tasks.reminders', description:'Cancels a task/reminder', async run(input){ const task=await service.get(input.taskId); if(task.userId!==userId) throw new Error('task not found'); return service.cancel(input.taskId); } } }),
    naia.registerCapability({ name:'task.reschedule', tool:{ risk:'LOCAL_WRITE', capability:'tasks.reminders', description:'Reschedules an active task/reminder', async run(input){ const task=await service.get(input.taskId); if(task.userId!==userId) throw new Error('task not found'); return service.reschedule(input.taskId,input.schedule); } } }),
  ];
}
