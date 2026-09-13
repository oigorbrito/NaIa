const STATES = new Set(['RECOGNIZED', 'AMBIGUOUS', 'MISSING_PARAMETER', 'UNRECOGNIZED']);

function text(value) { return String(value ?? '').trim(); }

function result({ intent, state, parameters = {}, original, provenance, ambiguity = null, missing = [] }) {
  if (!STATES.has(state)) throw new Error(`unsupported intent state: ${state}`);
  return Object.freeze({
    intent: intent ?? null,
    state,
    objective: Object.freeze({
      type: intent ?? 'UNKNOWN',
      parameters: Object.freeze({ ...parameters }),
      originalText: original,
      ambiguity,
      missingParameters: [...missing],
      provenance,
    }),
    parameters: Object.freeze({ ...parameters }),
    confidence: state === 'RECOGNIZED' ? 'OBSERVED' : null,
    ambiguity,
    provenance,
  });
}

export async function interpretText(input, context = {}, { rules = [] } = {}) {
  const original = text(input);
  for (const rule of rules) {
    if (typeof rule.match !== 'function' || typeof rule.interpret !== 'function') continue;
    if (await rule.match(original, context)) {
      const interpreted = await rule.interpret(original, context);
      return result({ ...interpreted, original, provenance: interpreted.provenance ?? rule.name ?? 'registered-rule' });
    }
  }

  const lower = original.toLowerCase();
  if (lower === 'time' || lower.includes('what time') || lower.includes('current time')) {
    return result({ intent: 'TIME_QUERY', state: 'RECOGNIZED', original, provenance: 'deterministic.time' });
  }
  const uppercase = original.match(/^uppercase\s*:?\s*(.*)$/i);
  if (uppercase) {
    if (!uppercase[1].trim()) return result({ intent: 'TEXT_TRANSFORM', state: 'MISSING_PARAMETER', original, provenance: 'deterministic.uppercase', missing: ['text'] });
    return result({ intent: 'TEXT_TRANSFORM', state: 'RECOGNIZED', parameters: { operation: 'UPPERCASE', text: uppercase[1].trim() }, original, provenance: 'deterministic.uppercase' });
  }
  const note = original.match(/^note\s+([^:]+):\s*(.+)$/i);
  if (note) return result({ intent: 'NOTE_WRITE', state: 'RECOGNIZED', parameters: { name: note[1].trim(), content: note[2].trim() }, original, provenance: 'deterministic.note' });
  const task = original.match(/^remind\s+me(?:\s+on\s+([^:]+))?:\s*(.+)$/i);
  if (task) return result({ intent: 'TASK_CREATE', state: 'RECOGNIZED', parameters: { due: task[1]?.trim() ?? null, title: task[2].trim() }, original, provenance: 'deterministic.task' });
  if (/^manda\s+isso\s+pra\s+ele$/i.test(original)) {
    return result({ intent: 'MESSAGE_SEND', state: 'AMBIGUOUS', original, provenance: 'deterministic.message', ambiguity: 'recipient is unresolved', missing: ['recipient'] });
  }
  if (/^apaga\s+os\s+arquivos\s+antigos$/i.test(original)) {
    return result({ intent: 'FILE_DELETE', state: 'AMBIGUOUS', original, provenance: 'deterministic.file-delete', ambiguity: 'file scope and confirmation are unresolved', missing: ['fileScope'] });
  }
  return result({ state: 'UNRECOGNIZED', original, provenance: 'deterministic.fallback' });
}

export function normalizeObjective(objective, interpretation) {
  return {
    ...objective,
    intentInterpretation: interpretation,
    normalizedIntent: interpretation.objective,
  };
}

export { STATES as INTENT_STATES };
