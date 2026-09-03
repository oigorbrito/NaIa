function getPath(value, path) {
  if (!path) return value;
  return String(path).split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function resultRef(stepId, path = '') {
  if (!stepId) throw new Error('result reference stepId is required');
  return { $result: { stepId: String(stepId), path: String(path ?? '') } };
}

export function isResultRef(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.$result?.stepId);
}

export function collectResultRefs(value, refs = []) {
  if (isResultRef(value)) {
    refs.push({ stepId: String(value.$result.stepId), path: String(value.$result.path ?? '') });
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResultRefs(item, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectResultRefs(item, refs);
  }
  return refs;
}

export function validatePlanDependencies(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const ids = new Set(steps.map((step) => step.id));
  const seen = new Set();
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`unknown step dependency: ${dependency}`);
      if (!seen.has(dependency)) throw new Error(`step dependency must reference an earlier step: ${dependency}`);
    }
    for (const ref of collectResultRefs(step.action?.input ?? {})) {
      if (!ids.has(ref.stepId)) throw new Error(`unknown result reference step: ${ref.stepId}`);
      if (!seen.has(ref.stepId)) throw new Error(`result reference must target an earlier step: ${ref.stepId}`);
    }
    seen.add(step.id);
  }
  return plan;
}

export function dependenciesSatisfied(plan, step) {
  const byId = new Map((plan?.steps ?? []).map((item) => [item.id, item]));
  const dependencies = new Set([...(step.dependsOn ?? []), ...collectResultRefs(step.action?.input ?? {}).map((ref) => ref.stepId)]);
  const blocked = [...dependencies].filter((id) => byId.get(id)?.status !== 'COMPLETED');
  return { satisfied: blocked.length === 0, blocked };
}

export function resolveResultRefs(value, resultStore) {
  if (isResultRef(value)) {
    const stepResult = resultStore.get(String(value.$result.stepId));
    if (stepResult === undefined) throw new Error(`result unavailable for step: ${value.$result.stepId}`);
    const resolved = getPath(stepResult, value.$result.path ?? '');
    if (resolved === undefined) throw new Error(`result path unavailable: ${value.$result.stepId}.${value.$result.path ?? ''}`);
    return clone(resolved);
  }
  if (Array.isArray(value)) return value.map((item) => resolveResultRefs(item, resultStore));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveResultRefs(item, resultStore)]));
  }
  return value;
}

export function createResultStore(evidence = []) {
  const values = new Map();
  for (const record of evidence ?? []) {
    if (record?.type === 'STEP_RESULT' && record.stepId) values.set(record.stepId, clone(record.result));
  }
  return {
    get(stepId) { return values.get(stepId); },
    has(stepId) { return values.has(stepId); },
    set(stepId, result) { values.set(stepId, clone(result)); },
    entries() { return [...values.entries()].map(([stepId, result]) => ({ stepId, result: clone(result) })); },
  };
}
