import { createApprovalPolicy } from '../../src/product/policy.mjs';

const READ_ONLY = new Set([
  'browser.read',
  'browser.extract',
  'browser.screenshot',
]);

const SIDE_EFFECTING = new Set([
  'browser.click',
  'browser.input',
  'browser.submit',
  'browser.download',
  'browser.upload',
]);

export function classifyBrowserAction(tool) {
  if (READ_ONLY.has(tool)) {
    return { known: true, requiresApproval: false, risk: 'READ_ONLY' };
  }
  if (SIDE_EFFECTING.has(tool)) {
    return { known: true, requiresApproval: true, risk: 'SIDE_EFFECT' };
  }
  return { known: false, requiresApproval: true, risk: 'UNKNOWN' };
}

export function createReverseGateway({ dispatch, policy = createApprovalPolicy() } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('dispatch function is required');

  return {
    async execute({ objective, proposal }) {
      if (!objective || !proposal || typeof proposal.tool !== 'string') {
        return { ok: false, error: 'invalid reverse-integration proposal', retryable: false };
      }

      const classification = classifyBrowserAction(proposal.tool);
      if (!classification.known) {
        return { ok: false, error: `unknown browser action: ${proposal.tool}`, retryable: false };
      }

      const step = {
        id: proposal.id ?? 'reverse-step',
        kind: 'EXECUTE',
        action: {
          tool: proposal.tool,
          input: proposal.input ?? {},
          risk: classification.risk,
          requiresApproval: classification.requiresApproval,
        },
      };

      const authorization = await policy.authorize({ objective, plan: { steps: [step] }, step });
      if (!authorization.allowed) {
        return {
          ok: false,
          blocked: true,
          error: authorization.reason,
          retryable: false,
          authorization,
        };
      }

      return dispatch({ objective, step, proposal });
    },
  };
}
