function normalize(value) {
  return String(value ?? '').trim();
}

function parseIso(value, label) {
  const text = normalize(value);
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) {
    const error = new Error(`${label} must be a valid date/time`);
    error.code = 'INVALID_CALENDAR_INPUT';
    throw error;
  }
  return date.toISOString();
}

function assertRange(start, end) {
  const normalizedStart = parseIso(start, 'start');
  const normalizedEnd = parseIso(end, 'end');
  if (normalizedEnd <= normalizedStart) {
    const error = new Error('calendar end must be after start');
    error.code = 'INVALID_CALENDAR_INPUT';
    throw error;
  }
  return { start: normalizedStart, end: normalizedEnd };
}

function parseParts(intent, prefix, count) {
  const expression = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.+)$`, 'i');
  const match = normalize(intent).match(expression);
  if (!match) return null;
  const parts = match[1].split('|').map((part) => part.trim());
  if (parts.length !== count || parts.some((part) => !part)) {
    const error = new Error(`invalid ${prefix} syntax`);
    error.code = 'INVALID_CALENDAR_INPUT';
    throw error;
  }
  return parts;
}

export function createCalendarCapabilities() {
  return [
    {
      id: 'calendar.list',
      description: 'List calendar events in a date range',
      match(intent) {
        const parts = parseParts(intent, 'calendar list', 2);
        if (!parts) return null;
        const range = assertRange(parts[0], parts[1]);
        return range;
      },
      buildAction({ match }) {
        return {
          tool: 'calendar.list',
          input: match,
          risk: 'READ_ONLY',
          requiresApproval: false,
        };
      },
    },
    {
      id: 'calendar.create',
      description: 'Create a calendar event',
      match(intent) {
        const parts = parseParts(intent, 'calendar create', 3);
        if (!parts) return null;
        const range = assertRange(parts[0], parts[1]);
        return { ...range, title: parts[2] };
      },
      buildAction({ match }) {
        return {
          tool: 'calendar.create',
          input: match,
          risk: 'EXTERNAL_WRITE',
          requiresApproval: true,
          approvalScope: 'calendar:create',
        };
      },
    },
    {
      id: 'calendar.update',
      description: 'Update a calendar event',
      match(intent) {
        const parts = parseParts(intent, 'calendar update', 4);
        if (!parts) return null;
        const range = assertRange(parts[1], parts[2]);
        return { eventId: parts[0], ...range, title: parts[3] };
      },
      buildAction({ match }) {
        return {
          tool: 'calendar.update',
          input: match,
          risk: 'EXTERNAL_WRITE',
          requiresApproval: true,
          approvalScope: `calendar:update:${match.eventId}`,
        };
      },
    },
  ];
}

function assertProvider(provider) {
  for (const method of ['list', 'create', 'update']) {
    if (typeof provider?.[method] !== 'function') throw new Error(`calendar provider.${method} must be a function`);
  }
  return provider;
}

function normalizeProviderError(error) {
  return {
    ok: false,
    error: error?.message ?? String(error),
    retryable: error?.retryable !== false,
  };
}

export function createCalendarExecutionAdapter({ provider } = {}) {
  const calendar = assertProvider(provider);
  const supported = new Set(['calendar.list', 'calendar.create', 'calendar.update']);

  return {
    supports(tool) {
      return supported.has(tool);
    },
    async run(request) {
      const action = request?.step?.action;
      const tool = action?.tool;
      try {
        if (tool === 'calendar.list') {
          const result = await calendar.list(action.input);
          return { ok: true, output: { tool, result } };
        }
        if (tool === 'calendar.create') {
          const result = await calendar.create(action.input);
          return { ok: true, output: { tool, result } };
        }
        if (tool === 'calendar.update') {
          const result = await calendar.update(action.input);
          return { ok: true, output: { tool, result } };
        }
        return { ok: false, error: `unsupported calendar tool: ${tool}`, retryable: false };
      } catch (error) {
        return normalizeProviderError(error);
      }
    },
  };
}
