export function createApprovalPolicy() {
  return {
    async authorize({ objective, step }) {
      if (!step?.action) return { allowed: true, reason: 'control-step' };
      if (!step.action.requiresApproval) return { allowed: true, reason: 'read-only' };
      const approvals = Array.isArray(objective.approvals) ? objective.approvals : [];
      const allowed = approvals.includes(step.action.tool);
      return {
        allowed,
        reason: allowed ? 'explicit-tool-approval' : 'approval-required',
        tool: step.action.tool,
        risk: step.action.risk,
      };
    },
  };
}
