function clone(value) { return value == null ? value : structuredClone(value); }

export function createSchedulerAdapter({ register, unregister, list } = {}) {
  if (typeof register !== 'function' || typeof unregister !== 'function') throw new Error('scheduler adapter register/unregister are required');
  return { register, unregister, list: typeof list === 'function' ? list : async () => [] };
}

export function createInMemorySchedulerAdapter() {
  const registrations = new Map();
  return createSchedulerAdapter({
    async register(input) {
      registrations.set(String(input.automationId), clone(input));
      return clone(input);
    },
    async unregister(automationId) {
      registrations.delete(String(automationId));
      return true;
    },
    async list() { return [...registrations.values()].map(clone); },
  });
}

export function createSchedulerBridge({ naia, scheduler, scheduleSource } = {}) {
  if (!naia?.automations) throw new Error('naia.automations is required');
  if (!scheduler?.register || !scheduler?.unregister) throw new Error('scheduler adapter is required');
  if (!scheduleSource?.emitOccurrence) throw new Error('schedule source is required');

  async function desired() {
    const automations = await naia.automations();
    return automations.filter((item) => item.enabled && item.trigger?.kind === 'SCHEDULE');
  }

  return {
    async sync() {
      const wanted = await desired();
      const current = new Map((await scheduler.list()).map((item) => [String(item.automationId), item]));
      const wantedIds = new Set(wanted.map((item) => String(item.id)));
      for (const automation of wanted) {
        await scheduler.register({
          automationId: automation.id,
          schedule: automation.trigger.schedule,
          timezone: automation.trigger.timezone ?? 'UTC',
          metadata: clone(automation.trigger.metadata ?? {}),
        });
      }
      for (const automationId of current.keys()) {
        if (!wantedIds.has(automationId)) await scheduler.unregister(automationId);
      }
      return { registered: wanted.length, active: await scheduler.list() };
    },
    async occurrence({ automationId, scheduledFor, metadata = {} }) {
      return scheduleSource.emitOccurrence({ automationId, scheduledFor, metadata });
    },
  };
}
