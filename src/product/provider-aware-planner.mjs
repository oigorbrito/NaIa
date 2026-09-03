import { actionFromCapability } from './capabilities.mjs';
import { evaluateCapabilityAvailability } from './connection-state.mjs';

function splitClauses(text) {
  return String(text ?? '').split(/\s+(?:then|and then|after that)\s+/i).map((part) => part.trim()).filter(Boolean);
}

function inferCapability(clause) {
  const lower = clause.toLowerCase();
  if (lower.includes('github') && lower.includes('issue') && (lower.includes('create') || lower.includes('open'))) return 'github.issue.create';
  if (lower.includes('github') && lower.includes('issue')) return 'github.issue.read';
  if ((lower.includes('gmail') || lower.includes('email')) && lower.includes('search')) return 'gmail.message.search';
  if ((lower.includes('gmail') || lower.includes('email')) && (lower.includes('send') || lower.includes('reply'))) return 'gmail.message.send';
  if ((lower.includes('calendar') || lower.includes('meeting')) && (lower.includes('create') || lower.includes('schedule'))) return 'calendar.event.create';
  if (lower.includes('calendar') || lower.includes('availability') || lower.includes('free busy')) return 'calendar.free_busy.read';
  return null;
}

function parseJsonObject(clause) {
  const start = clause.indexOf('{');
  if (start < 0) return {};
  const raw = clause.slice(start);
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('provider action input must be an object');
  return parsed;
}

export function createProviderAwarePlanner({ fallbackPlanner } = {}) {
  if (!fallbackPlanner?.plan) throw new Error('fallback planner is required');

  return {
    async plan(objective, context = {}) {
      const capabilities = context.capabilities;
      const connections = context.connections;
      const clauses = splitClauses(objective.title);
      const inferred = clauses.map((clause) => ({ clause, capability: inferCapability(clause) })).filter((item) => item.capability);
      if (!inferred.length) return fallbackPlanner.plan(objective, context);

      const understandId = `${objective.id}:understand`;
      const steps = [{ id: understandId, kind: 'UNDERSTAND', status: 'PENDING', action: null }];
      let previousStepId = understandId;
      for (let index = 0; index < inferred.length; index += 1) {
        const item = inferred[index];
        const descriptor = capabilities?.describe?.(item.capability);
        if (!descriptor) throw new Error(`capability not registered: ${item.capability}`);
        const connection = descriptor.provider && connections?.get ? await connections.get(descriptor.provider) : null;
        const availability = evaluateCapabilityAvailability(descriptor, connection);
        const action = actionFromCapability(capabilities, item.capability, parseJsonObject(item.clause));
        action.availability = availability;
        const id = `${objective.id}:provider:${index + 1}`;
        steps.push({ id, kind: 'EXECUTE', status: availability.available ? 'PENDING' : 'BLOCKED_CONNECTION', dependsOn: [previousStepId], action });
        previousStepId = id;
      }
      steps.push({ id: `${objective.id}:verify`, kind: 'VERIFY', status: 'PENDING', dependsOn: [previousStepId], action: null });
      return { objectiveId: objective.id, intent: objective.title, providerAware: true, orchestrationVersion: 1, steps };
    },
  };
}
