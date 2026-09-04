import { compileWorkflow, WorkflowStepKind } from './workflows.mjs';

function splitClauses(text) {
  return String(text ?? '').split(/\s+(?:then|and then|after that|depois|então)\s+/i).map((part) => part.trim()).filter(Boolean);
}

function inferCapability(clause) {
  const lower = clause.toLowerCase();
  if (lower.includes('github') && lower.includes('issue') && (lower.includes('create') || lower.includes('open') || lower.includes('crie') || lower.includes('abra'))) return 'github.issue.create';
  if (lower.includes('github') && lower.includes('issue')) return 'github.issue.read';
  if ((lower.includes('gmail') || lower.includes('email')) && (lower.includes('search') || lower.includes('procure') || lower.includes('busque'))) return 'gmail.message.search';
  if ((lower.includes('gmail') || lower.includes('email')) && (lower.includes('send') || lower.includes('reply') || lower.includes('envie') || lower.includes('mande'))) return 'gmail.message.send';
  if ((lower.includes('calendar') || lower.includes('meeting') || lower.includes('calendário')) && (lower.includes('create') || lower.includes('schedule') || lower.includes('agende') || lower.includes('crie'))) return 'calendar.event.create';
  if (lower.includes('calendar') || lower.includes('availability') || lower.includes('free busy') || lower.includes('disponibilidade')) return 'calendar.free_busy.read';
  return null;
}

function parseJsonObject(clause) {
  const start = clause.indexOf('{');
  if (start < 0) return {};
  const parsed = JSON.parse(clause.slice(start));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('automation action input must be a JSON object');
  return parsed;
}

export function authorWorkflowFromIntent(intent, { capabilities } = {}) {
  const clauses = splitClauses(intent);
  const actions = clauses.map((clause, index) => ({
    id: `action-${index + 1}`,
    clause,
    capability: inferCapability(clause),
    input: parseJsonObject(clause),
  })).filter((item) => item.capability);
  if (!actions.length) return null;
  for (const action of actions) {
    if (!capabilities?.describe?.(action.capability)) throw new Error(`capability not registered: ${action.capability}`);
  }
  return {
    id: `authored-${Date.now()}`,
    description: String(intent),
    authoredBy: 'deterministic-intent-planner',
    steps: actions.map((action, index) => ({
      id: action.id,
      kind: WorkflowStepKind.ACTION,
      capability: action.capability,
      input: action.input,
      dependsOn: index === 0 ? [] : [actions[index - 1].id],
    })),
  };
}

export function createAutomationPlanner({ fallbackPlanner } = {}) {
  if (!fallbackPlanner?.plan) throw new Error('fallback planner is required');
  return {
    async plan(objective, context = {}) {
      const definition = authorWorkflowFromIntent(objective.title, context);
      if (!definition) return fallbackPlanner.plan(objective, context);
      const plan = compileWorkflow(definition, { objectiveId: objective.id, capabilities: context.capabilities });
      plan.authored = true;
      plan.authoring = { mode: definition.authoredBy, sourceIntent: objective.title };
      return plan;
    },
  };
}
