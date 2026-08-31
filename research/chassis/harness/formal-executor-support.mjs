export const FORMAL_EXECUTOR_SUPPORT = Object.freeze({
  T5: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: Object.freeze(['Temporal TypeScript']),
    fault: 'two-worker-stale-authority-completion'
  }),
  T7: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: null,
    fault: 'worker-process-sigkill'
  }),
  T8: Object.freeze({
    modes: Object.freeze(['local-process', 'managed-controller']),
    candidates: null,
    fault: 'external-response-loss'
  })
});

export function formalExecutorSupportsCandidate(support, mutantId, candidate) {
  const implementation = support?.[mutantId];
  if (!implementation || !candidate) return false;
  if (Array.isArray(implementation.candidates) && !implementation.candidates.includes(candidate.candidate)) return false;
  if (Array.isArray(implementation.modes) && !implementation.modes.includes(candidate.mode)) return false;
  return true;
}
