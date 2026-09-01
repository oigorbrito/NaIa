export const REQUIRED_FORMAL_CLEANUP_PHASES = Object.freeze(['preRunCleanup', 'postRunCleanup']);

export const FORMAL_CLEANUP_SUPPORT = Object.freeze({
  'Temporal TypeScript': Object.freeze({ preRunCleanup: false, postRunCleanup: false }),
  'DBOS TypeScript': Object.freeze({ preRunCleanup: false, postRunCleanup: false }),
  Restate: Object.freeze({ preRunCleanup: false, postRunCleanup: false }),
  'Trigger.dev': Object.freeze({ preRunCleanup: false, postRunCleanup: false })
});

export function missingFormalCleanupPhases(cleanupSupport, candidateName) {
  const entry = cleanupSupport?.[candidateName] ?? {};
  return REQUIRED_FORMAL_CLEANUP_PHASES.filter((phase) => entry[phase] !== true);
}

export function formalCleanupSupportsCandidate(cleanupSupport, candidateName) {
  return missingFormalCleanupPhases(cleanupSupport, candidateName).length === 0;
}
