import { actionFromCapability } from './capabilities.mjs';
import { collectResultRefs, resultRef } from './orchestration.mjs';

export const WorkflowStepKind = Object.freeze({
  ACTION: 'ACTION', CONDITION: 'CONDITION', TRANSFORM: 'TRANSFORM', FAN_OUT: 'FAN_OUT', FAN_IN: 'FAN_IN',
});

function clone(value) { return value == null ? value : structuredClone(value); }
function getPath(value, path = '') { if (!path) return value; return String(path).split('.').filter(Boolean).reduce((current, key) => current?.[key], value); }
function assertId(id, label) { const value = String(id ?? '').trim(); if (!value) throw new Error(`${label} id is required`); return value; }
function normalizeDependsOn(value = []) { return [...new Set((value ?? []).map(String).filter(Boolean))]; }

function remapResultRefs(value, idMap) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$result?.stepId) {
    const sourceId = String(value.$result.stepId);
    return { $result: { stepId: idMap.get(sourceId) ?? sourceId, path: String(value.$result.path ?? '') } };
  }
  if (Array.isArray(value)) return value.map((entry) => remapResultRefs(entry, idMap));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remapResultRefs(entry, idMap)]));
  return value;
}

function detectCycles(steps) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`workflow dependency cycle detected at: ${id}`);
    const step = byId.get(id); if (!step) throw new Error(`unknown workflow dependency: ${id}`);
    visiting.add(id); for (const dep of step.dependsOn ?? []) visit(dep); visiting.delete(id); visited.add(id);
  }
  for (const step of steps) visit(step.id);
}

export function validateWorkflowDefinition(definition) {
  if (!definition?.id) throw new Error('workflow id is required');
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) throw new Error('workflow steps are required');
  const ids = new Set();
  for (const raw of definition.steps) { const id = assertId(raw.id, 'workflow step'); if (ids.has(id)) throw new Error(`duplicate workflow step id: ${id}`); ids.add(id); }
  for (const raw of definition.steps) {
    for (const dep of normalizeDependsOn(raw.dependsOn)) if (!ids.has(dep)) throw new Error(`unknown workflow dependency: ${dep}`);
    if (raw.kind === WorkflowStepKind.CONDITION) {
      if (!raw.when) throw new Error(`condition step ${raw.id} requires when`);
      for (const target of [...(raw.then ?? []), ...(raw.else ?? [])]) if (!ids.has(target)) throw new Error(`condition target not found: ${target}`);
    }
    if (raw.kind === WorkflowStepKind.ACTION && !raw.capability) throw new Error(`action step ${raw.id} requires capability`);
    if (raw.kind === WorkflowStepKind.FAN_OUT && !raw.capability) throw new Error(`fan-out step ${raw.id} requires capability`);
  }
  detectCycles(definition.steps.map((step) => ({ id: step.id, dependsOn: normalizeDependsOn(step.dependsOn) })));
  return definition;
}

export function compileWorkflow(definition, { objectiveId, capabilities } = {}) {
  validateWorkflowDefinition(definition);
  if (!objectiveId) throw new Error('objectiveId is required to compile workflow');
  const prefix = `${objectiveId}:workflow:`;
  const idMap = new Map(definition.steps.map((step) => [step.id, `${prefix}${step.id}`]));
  const steps = [{ id: `${prefix}understand`, kind: 'UNDERSTAND', status: 'PENDING', dependsOn: [], action: null }];
  for (const raw of definition.steps) {
    const id = idMap.get(raw.id); const dependsOn = normalizeDependsOn(raw.dependsOn).map((dep) => idMap.get(dep));
    if (raw.kind === WorkflowStepKind.ACTION) {
      const action = actionFromCapability(capabilities, raw.capability, remapResultRefs(clone(raw.input ?? {}), idMap));
      steps.push({ id, kind: 'EXECUTE', status: 'PENDING', dependsOn, action, workflow: { sourceId: raw.id } });
    } else if (raw.kind === WorkflowStepKind.CONDITION) {
      steps.push({ id, kind: 'CONDITION', status: 'PENDING', dependsOn, action: null, workflow: {
        sourceId: raw.id, when: remapResultRefs(clone(raw.when), idMap),
        then: (raw.then ?? []).map((target) => idMap.get(target)), else: (raw.else ?? []).map((target) => idMap.get(target)),
      } });
    } else if (raw.kind === WorkflowStepKind.TRANSFORM) {
      steps.push({ id, kind: 'TRANSFORM', status: 'PENDING', dependsOn, action: null, workflow: { sourceId: raw.id, value: remapResultRefs(clone(raw.value ?? null), idMap) } });
    } else if (raw.kind === WorkflowStepKind.FAN_OUT) {
      const descriptor = capabilities.describe(raw.capability); if (!descriptor) throw new Error(`capability not registered: ${raw.capability}`);
      steps.push({ id, kind: 'FAN_OUT', status: 'PENDING', dependsOn, action: null, workflow: {
        sourceId: raw.id, capability: raw.capability,
        items: remapResultRefs(clone(raw.items ?? []), idMap), input: remapResultRefs(clone(raw.input ?? {}), idMap),
        concurrency: Math.max(1, Number(raw.concurrency ?? 4)),
      } });
    } else if (raw.kind === WorkflowStepKind.FAN_IN) {
      steps.push({ id, kind: 'FAN_IN', status: 'PENDING', dependsOn, action: null, workflow: { sourceId: raw.id, from: (raw.from ?? []).map((target) => idMap.get(target)) } });
    } else throw new Error(`unsupported workflow step kind: ${raw.kind}`);
  }
  steps.push({ id: `${prefix}verify`, kind: 'VERIFY', status: 'PENDING', dependsOn: definition.steps.map((step) => idMap.get(step.id)), action: null });
  return { objectiveId, intent: definition.description ?? definition.id, workflowId: definition.id, declarative: true, steps };
}

export function evaluateCondition(condition, resultStore) {
  const left = resolveWorkflowValue(condition.left, resultStore); const right = resolveWorkflowValue(condition.right, resultStore);
  switch (condition.op ?? 'truthy') {
    case 'truthy': return Boolean(left); case 'falsy': return !left; case 'eq': return left === right; case 'neq': return left !== right;
    case 'gt': return left > right; case 'gte': return left >= right; case 'lt': return left < right; case 'lte': return left <= right;
    case 'includes': return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
    default: throw new Error(`unsupported condition operator: ${condition.op}`);
  }
}

export function resolveWorkflowValue(value, resultStore, item) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$item != null) return clone(getPath(item, value.$item));
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$result?.stepId) {
    const result = resultStore.get(String(value.$result.stepId)); if (result === undefined) throw new Error(`result unavailable for step: ${value.$result.stepId}`);
    const resolved = getPath(result, value.$result.path ?? ''); if (resolved === undefined) throw new Error(`result path unavailable: ${value.$result.stepId}.${value.$result.path ?? ''}`);
    return clone(resolved);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveWorkflowValue(entry, resultStore, item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveWorkflowValue(entry, resultStore, item)]));
  return value;
}

export function expandFanOut(plan, fanOutStep, resultStore, capabilities) {
  const items = resolveWorkflowValue(fanOutStep.workflow.items, resultStore); if (!Array.isArray(items)) throw new Error(`fan-out items must resolve to an array: ${fanOutStep.id}`);
  const index = plan.steps.findIndex((step) => step.id === fanOutStep.id);
  const children = items.map((item, itemIndex) => ({
    id: `${fanOutStep.id}:item:${itemIndex + 1}`, kind: 'EXECUTE', status: 'PENDING', dependsOn: [fanOutStep.id],
    action: actionFromCapability(capabilities, fanOutStep.workflow.capability, resolveWorkflowValue(fanOutStep.workflow.input, resultStore, item)),
    workflow: { fanOutParent: fanOutStep.id, itemIndex },
  }));
  plan.steps.splice(index + 1, 0, ...children);
  for (const step of plan.steps) if (step.kind === 'FAN_IN' && (step.workflow?.from ?? []).includes(fanOutStep.id)) {
    const retained = (step.dependsOn ?? []).filter((dep) => dep !== fanOutStep.id);
    step.dependsOn = [...new Set([...retained, ...children.map((child) => child.id)])];
    step.workflow.expandedFrom = { ...(step.workflow.expandedFrom ?? {}), [fanOutStep.id]: children.map((child) => child.id) };
  }
  return children;
}

export function collectFanInResult(step, resultStore) {
  const ids = Object.values(step.workflow?.expandedFrom ?? {}).flat(); const sourceIds = ids.length ? ids : (step.workflow?.from ?? []);
  return sourceIds.map((id) => ({ stepId: id, result: clone(resultStore.get(id)) }));
}

export function workflowResultRef(stepId, path = '') { return resultRef(stepId, path); }
export function collectWorkflowResultRefs(value) { return collectResultRefs(value); }
