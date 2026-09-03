import { actionFromCapability } from './capabilities.mjs';

function normalize(text) {
  return String(text ?? '').trim();
}

function parseNote(input) {
  const match = input.match(/^note\s+([^:]+):\s*(.+)$/i);
  if (!match) return null;
  return { name: match[1].trim(), content: match[2].trim() };
}

function fallbackAction(name, input, risk, scopes = []) {
  return {
    capability: name,
    tool: name,
    input,
    risk,
    scopes,
    requiresApproval: risk !== 'READ_ONLY',
  };
}

function action(capabilities, name, input, risk, scopes = []) {
  return capabilities ? actionFromCapability(capabilities, name, input) : fallbackAction(name, input, risk, scopes);
}

export function planIntent(objective, { capabilities } = {}) {
  const intent = normalize(objective.title);
  const lower = intent.toLowerCase();

  let plannedAction;
  if (lower === 'time' || lower.includes('what time') || lower.includes('current time')) {
    plannedAction = action(capabilities, 'time.now', {}, 'READ_ONLY', ['clock:read']);
  } else if (/^uppercase\s*:?\s*/i.test(intent)) {
    const text = intent.replace(/^uppercase\s*:?\s*/i, '');
    plannedAction = action(capabilities, 'text.uppercase', { text }, 'READ_ONLY', ['text:transform']);
  } else {
    const note = parseNote(intent);
    if (note) {
      plannedAction = action(capabilities, 'note.write', note, 'LOCAL_WRITE', ['workspace:notes:write']);
    } else {
      plannedAction = action(capabilities, 'text.echo', { text: intent }, 'READ_ONLY', ['text:read']);
    }
  }

  return {
    objectiveId: objective.id,
    intent,
    steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action: plannedAction },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
    ],
  };
}
