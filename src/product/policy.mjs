import { approvalToken } from './domain.mjs';

export function createApprovalPolicy() {
  return {
    async authorize({ objective, step }) {
      if (!step?.action) return { allowed: true, reason: 'control-step' };
      if (!step.action.requiresApproval) return { allowed: true, reason: 'read-only' };
      const approvals = Array.isArray(objective.approvals) ? objective.approvals : [];
      const scope = step.action.approvalScope ?? null;
      const token = approvalToken(step.action.tool, scope);
      const allowed = approvals.includes(token);
      return {
        allowed,
        reason: allowed ? (scope ? 'explicit-scoped-approval' : 'explicit-tool-approval') : 'approval-required',
        tool: step.action.tool,
        risk: step.action.risk,
        scope,
        token,
      };
    },
  };
}
