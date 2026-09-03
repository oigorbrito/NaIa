import { hasCapabilityApproval } from './domain.mjs';

export function createApprovalPolicy() {
  return {
    async authorize({ objective, step }) {
      if (!step?.action) return { allowed: true, reason: 'control-step' };
      if (!step.action.requiresApproval) return { allowed: true, reason: 'read-only' };

      const capability = step.action.capability ?? step.action.tool;
      const scopes = Array.isArray(step.action.scopes) ? step.action.scopes : [];
      const allowed = hasCapabilityApproval(objective, capability, scopes);
      return {
        allowed,
        reason: allowed ? 'explicit-scoped-approval' : 'approval-required',
        capability,
        tool: capability,
        scopes,
        risk: step.action.risk,
      };
    },
  };
}
