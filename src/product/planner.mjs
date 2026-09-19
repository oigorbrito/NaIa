function normalize(text) {
  return String(text ?? '').trim();
}

function parseNote(input) {
  const match = input.match(/^note\s+([^:]+):\s*(.+)$/i);
  if (!match) return null;
  return { name: match[1].trim(), content: match[2].trim() };
}

function parseTask(input) {
  const match = input.match(/^remind\s+me(?:\s+on\s+([^:]+))?:\s*(.+)$/i);
  if (!match) return null;
  return { title: match[2].trim(), due: match[1]?.trim() ?? null };
}

export function interpretIntent(title) {
  const intent = normalize(title);
  const lower = intent.toLowerCase();
  if (lower === 'time' || lower.includes('what time') || lower.includes('current time')) {
    return { kind: 'TIME_QUERY', text: intent };
  }
  const uppercase = intent.match(/^uppercase\s*:?\s*(.*)$/i);
  if (uppercase) return { kind: 'TEXT_TRANSFORM', operation: 'UPPERCASE', text: uppercase[1] };
  const note = parseNote(intent);
  if (note) return { kind: 'NOTE_WRITE', ...note };
  const task = parseTask(intent);
  if (task) return { kind: 'TASK_CREATE', ...task };
  return { kind: 'TEXT_ECHO', text: intent };
}

export async function planIntent(objective) {
  const intent = normalize(objective.title);
  const interpreted = await interpretText(intent);
  const structured = objective.normalizedIntent ?? objective.intentObjective;
  if (structured?.type && ['CALENDAR_LIST', 'CALENDAR_CREATE', 'CALENDAR_UPDATE', 'HTTP_READ'].includes(structured.type)) {
    const operation = structured.type === 'CALENDAR_LIST' ? 'list' : structured.type === 'CALENDAR_CREATE' ? 'create' : structured.type === 'CALENDAR_UPDATE' ? 'update' : 'read';
    const tool = structured.type === 'HTTP_READ' ? 'http.read' : `calendar.${operation}`;
    const risk = structured.type === 'CALENDAR_LIST' || structured.type === 'HTTP_READ' ? 'READ_ONLY' : 'EXTERNAL_WRITE';
    return { objectiveId: objective.id, intent: structured.type, normalizedObjective: structured, interpretation: null, steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action: { tool, input: structured.parameters ?? {}, risk, requiresApproval: risk !== 'READ_ONLY' } },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
    ] };
  }
  const normalized = normalizeObjective(objective, interpreted);

  if (interpreted.state === 'AMBIGUOUS' || interpreted.state === 'MISSING_PARAMETER') {
    return {
      objectiveId: objective.id,
      intent: interpreted.intent ?? 'UNRECOGNIZED',
      normalizedObjective: normalized.normalizedIntent,
      interpretation: interpreted,
      steps: [
        { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'COMPLETED', action: null },
        { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'FAILED', action: null, error: interpreted.state },
        { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
      ],
    };
  }

  let action;
  if (['CALENDAR_LIST', 'CALENDAR_CREATE', 'CALENDAR_UPDATE', 'HTTP_READ'].includes(interpreted.intent)) {
    const operation = interpreted.intent === 'CALENDAR_LIST' ? 'list' : interpreted.intent === 'CALENDAR_CREATE' ? 'create' : interpreted.intent === 'CALENDAR_UPDATE' ? 'update' : 'read';
    const tool = interpreted.intent === 'HTTP_READ' ? 'http.read' : `calendar.${operation}`;
    const risk = interpreted.intent === 'CALENDAR_LIST' || interpreted.intent === 'HTTP_READ' ? 'READ_ONLY' : 'EXTERNAL_WRITE';
    action = { tool, input: interpreted.parameters ?? {}, risk, requiresApproval: risk !== 'READ_ONLY' };
  } else if (interpreted.intent === 'TIME_QUERY') {
    action = { tool: 'time.now', input: {}, risk: 'READ_ONLY', requiresApproval: false };
  } else if (interpreted.intent === 'TEXT_TRANSFORM') {
    action = { tool: 'text.uppercase', input: { text: interpreted.parameters.text }, risk: 'READ_ONLY', requiresApproval: false };
  } else {
    if (interpreted.intent === 'NOTE_WRITE') {
      action = { tool: 'note.write', input: interpreted.parameters, risk: 'LOCAL_WRITE', requiresApproval: true };
    } else if (interpreted.intent === 'TASK_CREATE') {
      action = { tool: 'task.create', input: interpreted.parameters, risk: 'LOCAL_WRITE', requiresApproval: true };
    } else {
      action = { tool: 'text.echo', input: { text: intent }, risk: 'READ_ONLY', requiresApproval: false };
    }
  }

  return {
    objectiveId: objective.id,
    intent: interpreted.intent ?? interpreted.objective.type,
    normalizedObjective: normalized.normalizedIntent,
    interpretation: interpreted,
    steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
    ],
  };
}

function assertAction(action) {
  if (!action || typeof action !== 'object' || !String(action.tool ?? '').trim()) {
    throw new Error('planner rule action must provide a tool');
  }
  if (!['READ_ONLY', 'LOCAL_WRITE', 'EXTERNAL_WRITE', 'SENSITIVE'].includes(action.risk)) {
    throw new Error(`unsupported planner action risk: ${action.risk}`);
  }
  return {
    tool: String(action.tool).trim(),
    input: action.input ?? {},
    risk: action.risk,
    requiresApproval: Boolean(action.requiresApproval),
  };
}

export function createIntentPlanner({ rules = [] } = {}) {
  const registered = [...rules];
  return {
    register(rule) {
      if (!rule || typeof rule.match !== 'function' || typeof rule.action !== 'function') {
        throw new Error('planner rule must provide match and action functions');
      }
      registered.push(rule);
      return rule;
    },
    async interpret(text, context = {}) {
      return interpretText(text, context, { rules: registered });
    },
    async plan(objective) {
      for (const rule of registered) {
        if (await rule.match(objective)) {
          const action = assertAction(await rule.action(objective));
          return {
            objectiveId: objective.id,
            intent: normalize(objective.title),
            steps: [
              { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
              { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action },
              { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
            ],
          };
        }
      }
      return planIntent(objective);
    },
  };
}
import { interpretText, normalizeObjective } from './intent.mjs';
