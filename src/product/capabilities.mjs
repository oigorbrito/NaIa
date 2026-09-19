const CALENDAR_RISKS = Object.freeze({ list: 'READ_ONLY', create: 'EXTERNAL_WRITE', update: 'EXTERNAL_WRITE' });

function required(value, name) { if (!String(value ?? '').trim()) throw new Error(`${name} is required`); return String(value).trim(); }

export function createMemoryCalendarProvider() {
  const events = new Map();
  let sequence = 0;
  return {
    capabilities: () => ['calendar.list', 'calendar.create', 'calendar.update'],
    async run(operation, input = {}) {
      if (!['list', 'create', 'update'].includes(operation)) throw new Error(`calendar operation not supported: ${operation}`);
      if (operation === 'list') return { events: [...events.values()].map((event) => ({ ...event })) };
      if (operation === 'create') {
        const title = required(input.title, 'calendar title');
        const start = required(input.start, 'calendar start');
        if (!input.end && !input.duration) throw new Error('calendar end or duration is required');
        const event = { id: `event-${++sequence}`, title, start, ...(input.end ? { end: input.end } : { duration: input.duration }), ...(input.timezone ? { timezone: input.timezone } : {}) };
        events.set(event.id, event);
        return { event: { ...event }, provider: 'memory-calendar' };
      }
      const id = required(input.eventId, 'calendar eventId');
      if (!events.has(id)) throw new Error(`calendar event not found: ${id}`);
      const current = events.get(id);
      const changes = input.changes;
      if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) throw new Error('calendar changes are required');
      const updated = { ...current, ...changes, id };
      events.set(id, updated);
      return { event: { ...updated }, provider: 'memory-calendar' };
    },
  };
}

export function createHttpTargetRegistry() {
  const targets = new Map();
  return {
    register(target) {
      const id = required(target?.id, 'http target id');
      const method = String(target.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) throw new Error(`http read method not allowed: ${method}`);
      if (!target.endpoint || typeof target.endpoint !== 'string') throw new Error(`http target endpoint is required: ${id}`);
      targets.set(id, { id, endpoint: target.endpoint, method, description: target.description ?? '', availability: target.availability ?? 'AVAILABLE', config: target.config ?? {} });
      return this.describe(id);
    },
    describe(id) { return targets.has(id) ? { ...targets.get(id), config: { ...targets.get(id).config } } : null; },
    list() { return [...targets.keys()]; },
  };
}

export function createHttpReadCapability({ targets, executor } = {}) {
  if (!targets?.describe || typeof executor !== 'function') throw new Error('http read capability requires targets and executor');
  return {
    risk: 'READ_ONLY',
    async run(input = {}) {
      const targetId = required(input.targetId, 'http targetId');
      if (Object.prototype.hasOwnProperty.call(input, 'url')) throw new Error('arbitrary URL is not accepted');
      const target = targets.describe(targetId);
      if (!target) throw new Error(`http target not registered: ${targetId}`);
      if (target.availability !== 'AVAILABLE') throw new Error(`http target unavailable: ${target.availability}`);
      const response = await executor({ target: { ...target, config: undefined }, operation: 'read' });
      return { targetId, operation: 'read', method: target.method, status: response?.status ?? null, result: response?.result ?? null, executor: response?.executor ?? 'injected-http-executor' };
    },
  };
}

export function registerProductCapabilities({ registry, calendar = createMemoryCalendarProvider(), httpTargets = null, httpExecutor = null } = {}) {
  if (!registry?.register) throw new Error('capability registration requires a tool registry');
  for (const operation of ['list', 'create', 'update']) {
    registry.register(`calendar.${operation}`, { risk: CALENDAR_RISKS[operation], capability: 'calendar', description: `Calendar ${operation}`, async run(input) { return calendar.run(operation, input); } });
  }
  if (httpTargets && httpExecutor) {
    const http = createHttpReadCapability({ targets: httpTargets, executor: httpExecutor });
    registry.register('http.read', { risk: http.risk, capability: 'http.read', description: 'Read a configured HTTP target', run: http.run });
  }
  return { calendar, http: httpTargets && httpExecutor ? createHttpReadCapability({ targets: httpTargets, executor: httpExecutor }) : null };
}

export { CALENDAR_RISKS };
