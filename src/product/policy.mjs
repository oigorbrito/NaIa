export function createApprovalPolicy({ registry = null } = {}) {
  return {
    async authorize({ objective, step }) {
      if (!step?.action) return { allowed: true, reason: 'control-step' };
      const declaredRisk = step.action.risk;
      const registered = registry?.describe?.(step.action.tool);
      if (registry && !registered) {
        return { allowed: false, reason: 'unknown-tool', tool: step.action.tool, risk: declaredRisk };
      }
      if (registered && registered.risk !== declaredRisk) {
        return {
          allowed: false,
          reason: 'risk-mismatch',
          tool: step.action.tool,
          risk: registered.risk,
          declaredRisk,
        };
      }
      const requiresApproval = step.action.requiresApproval
        || !['READ_ONLY'].includes(registered?.risk ?? declaredRisk);
      if (!requiresApproval) return { allowed: true, reason: 'read-only' };
      const approvals = Array.isArray(objective.approvals) ? objective.approvals : [];
      const allowed = approvals.includes(step.action.tool);
      return {
        allowed,
        reason: allowed ? 'explicit-tool-approval' : 'approval-required',
        tool: step.action.tool,
        risk: registered?.risk ?? declaredRisk,
      };
    },
  };
}
