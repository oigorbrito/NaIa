import { currentLifecycleQualificationSha256 } from './formal-lifecycle-qualification-provenance.mjs';
import { executionRefRepositoryRevision, gitRevisionValid } from './repository-provenance.mjs';

export const REQUIRED_FORMAL_CLEANUP_PHASES = Object.freeze(['preRunCleanup', 'postRunCleanup']);

const UNVERIFIED_EVIDENCE = null;

export const FORMAL_CLEANUP_SUPPORT = Object.freeze({
  'Temporal TypeScript': Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-runtime-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until lifecycle tests and an isolated T5/r1 receipt execute successfully and record/validator/harness/lifecycle-qualification hashes plus the exact Git repository revision are recorded.'
  }),
  'DBOS TypeScript': Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-dbos-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until lifecycle tests and an isolated T5/r1 receipt execute successfully and record/validator/harness/lifecycle-qualification hashes plus the exact Git repository revision are recorded.'
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

export function expectedLifecycleExperimentId(candidateName) {
  if (!nonEmpty(candidateName)) return null;
  return `${candidateName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-t5-001`;
}

export function runtimeVerificationEvidenceValid(evidence, candidateName = null) {
  const expectedExperimentId = candidateName ? expectedLifecycleExperimentId(candidateName) : null;
  const currentQualificationSha = candidateName ? currentLifecycleQualificationSha256(candidateName) : null;
  const executionRevision = executionRefRepositoryRevision(evidence?.executionRef);
  const repositoryRevision = gitRevisionValid(evidence?.repositoryRevision)
    ? String(evidence.repositoryRevision).trim().toLowerCase()
    : null;

  return Boolean(
    evidence &&
    nonEmpty(evidence.executionRef) &&
    executionRevision &&
    repositoryRevision &&
    executionRevision === repositoryRevision &&
    nonEmpty(evidence.experimentId) &&
    (!expectedExperimentId || evidence.experimentId === expectedExperimentId) &&
    evidence.mutantId === 'T5' &&
    evidence.repetition === 1 &&
    sha256(evidence.recordSha256) &&
    sha256(evidence.validatorSha256) &&
    sha256(evidence.harnessSha256) &&
    sha256(evidence.lifecycleQualificationSha256) &&
    (!candidateName || (currentQualificationSha && evidence.lifecycleQualificationSha256 === currentQualificationSha)) &&
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
    runtimeVerificationEvidenceValid(entry.verificationEvidence, candidateName);
}
