export const REQUIRED_FORMAL_CLEANUP_PHASES = Object.freeze(['preRunCleanup', 'postRunCleanup']);

const UNVERIFIED_EVIDENCE = null;

export const FORMAL_CLEANUP_SUPPORT = Object.freeze({
  'Temporal TypeScript': Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-runtime-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until the lifecycle tests and at least one isolated T5/r1 runtime receipt execute successfully and the receipt hashes are recorded.'
  }),
  'DBOS TypeScript': Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-dbos-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until the lifecycle tests and at least one isolated T5/r1 runtime receipt execute successfully and the receipt hashes are recorded.'
  }),
  Restate: Object.freeze({ preRunCleanup: false, postRunCleanup: false, status: 'NOT_IMPLEMENTED', verificationEvidence: null }),
  'Trigger.dev': Object.freeze({ preRunCleanup: false, postRunCleanup: false, status: 'NOT_IMPLEMENTED', verificationEvidence: null })
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function runtimeVerificationEvidenceValid(evidence) {
  return Boolean(
    evidence &&
    nonEmpty(evidence.executionRef) &&
    nonEmpty(evidence.experimentId) &&
    evidence.mutantId === 'T5' &&
    evidence.repetition === 1 &&
    sha256(evidence.recordSha256) &&
    sha256(evidence.validatorSha256) &&
    nonEmpty(evidence.verifiedAt)
  );
}

export function missingFormalCleanupPhases(cleanupSupport, candidateName) {
  const entry = cleanupSupport?.[candidateName] ?? {};
  return REQUIRED_FORMAL_CLEANUP_PHASES.filter((phase) => entry[phase] !== true);
}

export function formalCleanupSupportsCandidate(cleanupSupport, candidateName) {
  const entry = cleanupSupport?.[candidateName] ?? {};
  return missingFormalCleanupPhases(cleanupSupport, candidateName).length === 0 &&
    entry.status === 'RUNTIME_VERIFIED' &&
    runtimeVerificationEvidenceValid(entry.verificationEvidence);
}
