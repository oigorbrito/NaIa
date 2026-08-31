export const FORMAL_EXECUTOR_SUPPORT = Object.freeze({
  T5: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: Object.freeze(['Temporal TypeScript', 'DBOS TypeScript']),
    fault: 'two-worker-live-ownership-race'
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
  }),
  T11: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: Object.freeze(['Temporal TypeScript', 'DBOS TypeScript']),
    fault: 'durable-cancel-worker-sigkill-recovery-challenge'
  }),
  T12: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: Object.freeze(['Temporal TypeScript', 'DBOS TypeScript']),
    fault: 'late-stale-completion-after-new-authority-commit'
  }),
  T16: Object.freeze({
    modes: Object.freeze(['local-process']),
    candidates: Object.freeze(['Temporal TypeScript', 'DBOS TypeScript', 'Restate']),
    fault: 'native-semantic-compatibility-recovery'
  })
});

export function formalExecutorSupportsCandidate(support, mutantId, candidate) {
  const implementation = support?.[mutantId];
  if (!implementation || !candidate) return false;
  if (Array.isArray(implementation.candidates) && !implementation.candidates.includes(candidate.candidate)) return false;
  if (Array.isArray(implementation.modes) && !implementation.modes.includes(candidate.mode)) return false;
  return true;
}
