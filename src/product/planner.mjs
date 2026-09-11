function normalize(text) {
  return String(text ?? '').trim();
}

function parseNote(input) {
  const match = input.match(/^note\s+([^:]+):\s*(.+)$/i);
  if (!match) return null;
  return { name: match[1].trim(), content: match[2].trim() };
}

export function planIntent(objective) {
  const intent = normalize(objective.title);
  const lower = intent.toLowerCase();

  let action;
  if (lower === 'time' || lower === 'what time' || lower === 'current time') {
    action = { tool: 'time.now', input: {}, risk: 'READ_ONLY', requiresApproval: false };
  } else if (/^uppercase\s*:?\s*/i.test(intent)) {
    const text = intent.replace(/^uppercase\s*:?\s*/i, '');
    action = { tool: 'text.uppercase', input: { text }, risk: 'READ_ONLY', requiresApproval: false };
  } else {
    const note = parseNote(intent);
    if (note) {
      action = { tool: 'note.write', input: note, risk: 'LOCAL_WRITE', requiresApproval: true };
    } else {
      const error = new Error(`unsupported intent: ${intent}`);
      error.code = 'UNSUPPORTED_INTENT';
      throw error;
    }
  }

  return {
    objectiveId: objective.id,
    intent,
    steps: [
      { id: `${objective.id}:understand`, kind: 'UNDERSTAND', status: 'PENDING', action: null },
      { id: `${objective.id}:execute`, kind: 'EXECUTE', status: 'PENDING', action },
      { id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', action: null },
    ],
  };
}
