import { deriveFormalEnvironmentIdentity } from './formal-environment-identity.mjs';
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
    note: 'Do not set cleanup support true until lifecycle tests and an isolated T5/r1 receipt execute successfully and record/validator/harness/lifecycle-qualification/native-runtime hashes plus the exact Git repository revision are recorded.'
  }),
  'DBOS TypeScript': Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-dbos-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until lifecycle tests and an isolated T5/r1 receipt execute successfully and record/validator/harness/lifecycle-qualification/native-runtime hashes plus the exact Git repository revision are recorded.'
  }),
  Restate: Object.freeze({
    preRunCleanup: false,
    postRunCleanup: false,
    implementation: 'research/chassis/harness/formal-restate-lifecycle.mjs',
    status: 'IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    verificationEvidence: UNVERIFIED_EVIDENCE,
    note: 'Do not set cleanup support true until the isolated Restate 1.7.8 lifecycle and T5/r1 receipt execute successfully with the observed server SHA-256, record/validator/harness/lifecycle-qualification/native-runtime hashes and exact Git repository revision recorded.'
  }),
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
    sha256(evidence.runtimeIdentitySha256) &&
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

export function assessLifecycleRuntimeIdentityBinding(record, cleanupSupport, candidateName = record?.candidate) {
  if (record?.setup?.status !== 'READY') {
    return {
      applicable: false,
      compatible: true,
      candidate: candidateName ?? null,
      expectedRuntimeIdentitySha256: null,
      observedRuntimeIdentitySha256: null,
      errors: []
    };
  }

  const entry = cleanupSupport?.[candidateName] ?? {};
  const expectedRuntimeIdentitySha256 = entry?.verificationEvidence?.runtimeIdentitySha256 ?? null;
  const identity = deriveFormalEnvironmentIdentity(record);
  const observedRuntimeIdentitySha256 = identity?.runtimeIdentitySha256 ?? null;
  const errors = [];

  if (!sha256(expectedRuntimeIdentitySha256)) {
    errors.push(`${candidateName ?? 'unknown candidate'}: runtime-verified cleanup support lacks qualification native runtime identity SHA-256`);
  }
  if (!identity?.applicable || !identity?.valid || !sha256(observedRuntimeIdentitySha256)) {
    errors.push(`${candidateName ?? 'unknown candidate'}: READY formal record lacks a valid native runtime identity SHA-256`);
  } else if (sha256(expectedRuntimeIdentitySha256) && observedRuntimeIdentitySha256 !== expectedRuntimeIdentitySha256) {
    errors.push(`${candidateName ?? 'unknown candidate'}: READY formal record native runtime identity differs from lifecycle qualification runtime identity`);
  }

  return {
    applicable: true,
    compatible: errors.length === 0,
    candidate: candidateName ?? null,
    expectedRuntimeIdentitySha256: sha256(expectedRuntimeIdentitySha256) ? expectedRuntimeIdentitySha256 : null,
    observedRuntimeIdentitySha256: sha256(observedRuntimeIdentitySha256) ? observedRuntimeIdentitySha256 : null,
    errors
  };
}
