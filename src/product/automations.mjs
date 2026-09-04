import { randomUUID } from 'node:crypto';
import { validateWorkflowDefinition } from './workflows.mjs';

export const AutomationTriggerKind = Object.freeze({
  MANUAL: 'MANUAL',
  SCHEDULE: 'SCHEDULE',
  EVENT: 'EVENT',
});

function clone(value) { return value == null ? value : structuredClone(value); }

function normalizeTrigger(trigger = { kind: AutomationTriggerKind.MANUAL }) {
  const kind = String(trigger?.kind ?? AutomationTriggerKind.MANUAL).toUpperCase();
  if (!Object.values(AutomationTriggerKind).includes(kind)) throw new Error(`unsupported automation trigger: ${kind}`);
  if (kind === AutomationTriggerKind.SCHEDULE) {
    const schedule = String(trigger.schedule ?? '').trim();
    if (!schedule) throw new Error('schedule trigger requires schedule');
    return { kind, schedule, timezone: String(trigger.timezone ?? 'UTC'), metadata: clone(trigger.metadata ?? {}) };
  }
  if (kind === AutomationTriggerKind.EVENT) {
    const event = String(trigger.event ?? '').trim();
    if (!event) throw new Error('event trigger requires event');
    return { kind, event, source: String(trigger.source ?? ''), metadata: clone(trigger.metadata ?? {}) };
  }
  return { kind: AutomationTriggerKind.MANUAL, metadata: clone(trigger.metadata ?? {}) };
}

function normalizeParameters(parameters = {}) {
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') throw new Error('automation parameters must be an object');
  return Object.fromEntries(Object.entries(parameters).map(([name, spec]) => {
    const key = String(name).trim();
    if (!key) throw new Error('automation parameter name is required');
    const normalized = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
    return [key, {
      required: Boolean(normalized.required),
      default: clone(normalized.default),
      description: String(normalized.description ?? ''),
    }];
  }));
}

export function createAutomationDefinition({
  id = randomUUID(), name, description = '', enabled = false, trigger, parameters = {}, workflow,
  createdAt = new Date().toISOString(), updatedAt = createdAt,
}) {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) throw new Error('automation name is required');
  validateWorkflowDefinition(workflow);
  return {
    id: String(id),
    name: normalizedName,
    description: String(description ?? ''),
    enabled: Boolean(enabled),
    trigger: normalizeTrigger(trigger),
    parameters: normalizeParameters(parameters),
    workflow: clone(workflow),
    createdAt,
    updatedAt,
  };
}

function resolveParamValue(value, params) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$param) {
    const name = String(value.$param);
    if (!(name in params)) throw new Error(`automation parameter unavailable: ${name}`);
    return clone(params[name]);
  }
  if (Array.isArray(value)) return value.map((item) => resolveParamValue(item, params));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveParamValue(item, params)]));
  }
  return value;
}

export function resolveAutomationParameters(definition, supplied = {}) {
  const resolved = {};
  for (const [name, spec] of Object.entries(definition.parameters ?? {})) {
    if (Object.prototype.hasOwnProperty.call(supplied, name)) resolved[name] = clone(supplied[name]);
    else if (spec.default !== undefined) resolved[name] = clone(spec.default);
    else if (spec.required) throw new Error(`required automation parameter missing: ${name}`);
  }
  for (const [name, value] of Object.entries(supplied ?? {})) {
    if (!(name in (definition.parameters ?? {}))) throw new Error(`unknown automation parameter: ${name}`);
    resolved[name] = clone(value);
  }
  return resolved;
}

export function instantiateAutomationWorkflow(definition, supplied = {}) {
  const params = resolveAutomationParameters(definition, supplied);
  const workflow = resolveParamValue(definition.workflow, params);
  validateWorkflowDefinition(workflow);
  return { workflow, parameters: params };
}

export function createAutomationStore(initial = []) {
  const values = new Map(initial.map((input) => {
    const automation = createAutomationDefinition(input);
    return [automation.id, automation];
  }));
  return {
    async save(input) {
      const existing = input?.id ? values.get(String(input.id)) : null;
      const automation = createAutomationDefinition({
        ...input,
        createdAt: existing?.createdAt ?? input?.createdAt,
        updatedAt: new Date().toISOString(),
      });
      values.set(automation.id, automation);
      return clone(automation);
    },
    async get(id) { const value = values.get(String(id)); return value ? clone(value) : null; },
    async list() { return [...values.values()].map(clone); },
    async setEnabled(id, enabled) {
      const existing = values.get(String(id));
      if (!existing) throw new Error(`automation not found: ${id}`);
      return this.save({ ...existing, enabled: Boolean(enabled) });
    },
  };
}

export function assertTriggerMatches(automation, trigger = {}) {
  const expected = automation.trigger?.kind ?? AutomationTriggerKind.MANUAL;
  const actual = String(trigger.kind ?? AutomationTriggerKind.MANUAL).toUpperCase();
  if (actual !== expected) throw new Error(`automation trigger mismatch: expected ${expected}, received ${actual}`);
  if (expected === AutomationTriggerKind.EVENT && trigger.event && trigger.event !== automation.trigger.event) {
    throw new Error(`automation event mismatch: expected ${automation.trigger.event}`);
  }
  return true;
}
