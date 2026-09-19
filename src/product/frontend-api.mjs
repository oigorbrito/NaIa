function clone(value) { return structuredClone(value); }

function normalizeError(error) {
  return {
    code: error?.code ?? 'INTERNAL_ERROR',
    message: error?.message ?? String(error),
    retryable: Boolean(error?.retryable),
  };
}

function objectiveView(snapshot) {
  const objective = snapshot?.objective ?? null;
  const plan = snapshot?.plan ?? null;
  const evidence = snapshot?.evidence ?? [];
  if (!objective) return null;
  const steps = (plan?.steps ?? []).map((step) => ({
    id: step.id, kind: step.kind, status: step.status,
    tool: step.action?.tool ?? null, risk: step.action?.risk ?? null,
    requiresApproval: Boolean(step.action?.requiresApproval),
    error: step.error ?? null,
  }));
  const pendingApprovals = steps.filter((step) => step.status === 'AWAITING_APPROVAL').map((step) => ({
    objectiveId: objective.id, stepId: step.id, tool: step.tool, risk: step.risk,
  }));
  const pendingConfirmations = (plan?.steps ?? []).filter((step) => step.status === 'AWAITING_CONFIRMATION').map((step) => ({
    objectiveId: objective.id, stepId: step.id, confirmationId: String(step.confirmation?.id ?? ''), payload: clone(step.confirmation?.payload ?? null),
  }));
  return {
    id: objective.id, title: objective.title, description: objective.description ?? '',
    status: objective.status, createdAt: objective.createdAt, updatedAt: objective.updatedAt,
    steps, pendingApprovals, pendingConfirmations, evidence: clone(evidence),
  };
}

export function createFrontendApi({
  naia,
  userId,
  tasks = null,
  entitlements = null,
  meter = null,
  connectors = null,
  historyIndex = null,
} = {}) {
  if (!naia || typeof naia.pursue !== 'function' || typeof naia.get !== 'function') throw new Error('NaIA service is required');
  if (!userId) throw new Error('userId is required');

  return {
    async submit({ text, description = '' }) {
      try {
        const result = await naia.pursue({ title: String(text ?? ''), description });
        const snapshot = await naia.get(result.objective.id);
        return { ok: true, objective: objectiveView(snapshot) };
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    },

    async objective(id) {
      try {
        const snapshot = await naia.get(id);
        if (!snapshot?.objective) return { ok: false, error: { code: 'NOT_FOUND', message: 'objective not found', retryable: false } };
        return { ok: true, objective: objectiveView(snapshot) };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async history() {
      try { return { ok: true, objectives: clone(await naia.history()) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async historySearch(filters = {}) {
      if (!historyIndex || typeof historyIndex.search !== 'function') return { ok: true, available: false, items: [] };
      try { const result = await historyIndex.search({ userId, ...filters }); return { ok: true, available: true, ...clone(result) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async historyExport() {
      if (!historyIndex || typeof historyIndex.export !== 'function') return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'history export unavailable', retryable: false } };
      try { return { ok: true, export: clone(await historyIndex.export(userId)) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async deleteHistory(id) {
      if (!historyIndex || typeof historyIndex.delete !== 'function') return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'history deletion unavailable', retryable: false } };
      try { return { ok: true, ...clone(await historyIndex.delete({ userId, id })) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async approvals() {
      try {
        const history = await naia.history();
        const items = [];
        for (const row of history) {
          if (row.status !== 'WAITING_APPROVAL') continue;
          const snapshot = await naia.get(row.id);
          const view = objectiveView(snapshot);
          items.push(...view.pendingApprovals);
        }
        const confirmations = [];
        for (const row of history) {
          if (row.status !== 'WAITING_CONFIRMATION') continue;
          const snapshot = await naia.get(row.id);
          const view = objectiveView(snapshot);
          confirmations.push(...view.pendingConfirmations);
        }
        return { ok: true, approvals: items, confirmations };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async confirm({ objectiveId, confirmationId }) {
      if (typeof naia.confirm !== 'function') return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'confirmation action unavailable', retryable: false } };
      try {
        await naia.confirm(objectiveId, confirmationId);
        return { ok: true, objective: objectiveView(await naia.get(objectiveId)) };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async approve({ objectiveId, tool }) {
      try {
        await naia.approve(objectiveId, tool);
        return { ok: true, objective: objectiveView(await naia.get(objectiveId)) };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async resume(objectiveId) {
      try {
        await naia.resume(objectiveId);
        return { ok: true, objective: objectiveView(await naia.get(objectiveId)) };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async automations() {
      if (!tasks || typeof tasks.list !== 'function') return { ok: true, items: [], available: false };
      try { return { ok: true, items: clone(await tasks.list(userId)), available: true }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async cancelAutomation(id) {
      if (!tasks || typeof tasks.cancel !== 'function') return { ok: false, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'task service unavailable', retryable: false } };
      try { return { ok: true, item: clone(await tasks.cancel(id)) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async premiumState() {
      if (!entitlements) return { ok: true, available: false, plan: null, usage: [] };
      try {
        const resolved = await entitlements.resolve(userId);
        const metrics = [
          ['executions.daily','DAY'],
          ['executions.monthly','MONTH'],
          ['scheduledTasks.active','ACTIVE'],
          ['modelUnits.monthly','MONTH'],
        ];
        const usage = [];
        if (meter?.inspect) {
          for (const [metric, window] of metrics) usage.push(await meter.inspect({ userId, metric, window }));
        }
        return {
          ok: true, available: true,
          plan: { id: resolved.planId, billingState: resolved.billingState, reason: resolved.reason, capabilities: clone(resolved.effectivePlan.capabilities), limits: clone(resolved.effectivePlan.limits) },
          usage,
        };
      } catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async connectorState() {
      if (!connectors || typeof connectors.list !== 'function') return { ok: true, available: false, connectors: [] };
      try { return { ok: true, available: true, connectors: clone(await connectors.list({ userId })) }; }
      catch (error) { return { ok: false, error: normalizeError(error) }; }
    },

    async shell() {
      const [history, advancedHistory, approvals, automations, premium, connectorState] = await Promise.all([
        this.history(), this.historySearch({ limit: 20 }), this.approvals(), this.automations(), this.premiumState(), this.connectorState(),
      ]);
      return {
        ok: [history, advancedHistory, approvals, automations, premium, connectorState].every((row) => row.ok),
        navigation: ['chat','objectives','approvals','automations','connectors','history','settings'],
        surfaces: { history, advancedHistory, approvals, automations, premium, connectors: connectorState },
      };
    },
  };
}
