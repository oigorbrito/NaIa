import { buildExecutionPlan } from './experiment-executor.mjs';
import { validateExperimentRecord } from './experiment-record-schema-validator.mjs';
import {
  FORMAL_CLEANUP_SUPPORT,
  assessLifecycleRuntimeIdentityBinding,
  formalCleanupSupportsCandidate
} from './formal-cleanup-support.mjs';
import { assessCandidateProfileBinding } from './formal-candidate-profile-binding.mjs';
import { assessFormalEnvironmentConsistency, deriveFormalEnvironmentIdentity } from './formal-environment-identity.mjs';
import {
  lifecycleQualificationRecordProvenanceStructurallyValid,
  lifecycleQualificationRecordProvenanceValid
} from './formal-lifecycle-qualification-provenance.mjs';
import {
  formalPromotionPolicyProvenanceStructurallyValid,
  formalPromotionPolicyProvenanceValid
} from './formal-promotion-policy.mjs';
import { validateWorkerPidCleanupEvidence } from './formal-worker-pid-provenance.mjs';
import { repositoryProvenanceReady, repositoryProvenanceStructurallyValid } from './repository-provenance.mjs';

const CLEANUP_DIMENSIONS = Object.freeze([
  'workerCleanup',
  'durableStateCleanup',
  'oracleCleanup',
  'temporaryResourcesCleanup'
]);

function sameIdentity(record, spec) {
  return record?.experimentId === spec.experimentId
    && record?.candidate === spec.candidate
    && record?.mutantId === spec.mutantId
    && record?.repetition === spec.repetition
    && record?.randomSeed === spec.randomSeed;
}

function preRunCleanupReceiptValid(receipt) {
  return receipt?.status === 'PASS' && CLEANUP_DIMENSIONS.every((key) => receipt?.[key] === true);
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function validateRecordAgainstSpec(record, spec) {
  const errors = [];
  const validation = validateExperimentRecord(record);
  if (!validation.valid) errors.push(...validation.errors.map((error) => `record: ${error}`));
  if (!spec || typeof spec !== 'object') return { valid: false, errors: [...errors, 'spec is required'] };

  if (record?.experimentId !== spec.experimentId) errors.push(`experimentId mismatch: expected ${spec.experimentId}, got ${record?.experimentId ?? 'missing'}`);
  if (record?.candidate !== spec.candidate) errors.push(`candidate mismatch: expected ${spec.candidate}, got ${record?.candidate ?? 'missing'}`);
  if (record?.mutantId !== spec.mutantId) errors.push(`mutantId mismatch: expected ${spec.mutantId}, got ${record?.mutantId ?? 'missing'}`);
  if (record?.repetition !== spec.repetition) errors.push(`repetition mismatch: expected ${spec.repetition}, got ${record?.repetition ?? 'missing'}`);
  if (record?.randomSeed !== spec.randomSeed) errors.push(`randomSeed mismatch: expected ${spec.randomSeed}, got ${record?.randomSeed ?? 'missing'}`);

  return { valid: errors.length === 0, errors };
}

export function auditStoredFormalRecord(record) {
  const errors = [];
  const schema = validateExperimentRecord(record);
  if (!schema.valid) errors.push(...schema.errors.map((error) => `record: ${error}`));

  const candidate = record?.candidate ?? 'unknown candidate';
  const environment = record?.setup?.environment ?? {};
  const lifecycle = environment.formalRuntimeLifecycle;

  if (!repositoryProvenanceStructurallyValid(environment.repositoryProvenance)) {
    errors.push(`${candidate}: stored formal record lacks structurally valid Git repository provenance`);
  }

  if (!sha256(record?.setup?.harnessSha256)) {
    errors.push(`${candidate}: stored formal record lacks structurally valid formal harness SHA-256 provenance`);
  }

  if (!lifecycle || lifecycle.candidate !== record?.candidate || lifecycle.status !== 'RUNTIME_VERIFIED') {
    errors.push(`${candidate}: stored formal record lacks immutable RUNTIME_VERIFIED lifecycle provenance`);
  }

  if (!lifecycleQualificationRecordProvenanceStructurallyValid(
    environment.formalLifecycleQualification,
    record?.candidate
  )) {
    errors.push(`${candidate}: stored formal record lacks structurally valid lifecycle qualification provenance`);
  }

  if (!formalPromotionPolicyProvenanceStructurallyValid(environment.formalPromotionPolicy)) {
    errors.push(`${candidate}: stored formal record lacks structurally valid promotion policy provenance`);
  }

  if (record?.setup?.status === 'READY') {
    if (!repositoryProvenanceReady(environment.repositoryProvenance)) {
      errors.push(`${candidate}: READY stored formal record requires verified clean Git repository revision provenance`);
    }
    const formalEnvironment = deriveFormalEnvironmentIdentity(record);
    if (!formalEnvironment.valid) {
      for (const error of formalEnvironment.errors) errors.push(`${candidate}: READY stored formal record environment identity: ${error}`);
    }
    if (!preRunCleanupReceiptValid(record?.setup?.preRunCleanupReceipt)) {
      errors.push(`${candidate}: READY stored formal record lacks a complete PASS pre-run cleanup receipt`);
    }
    if (record?.cleanup?.status !== 'PASS') {
      errors.push(`${candidate}: READY stored formal record requires cleanup.status=PASS`);
    }
  }

  const pidEvidence = validateWorkerPidCleanupEvidence({
    setupStatus: record?.setup?.status,
    mutantId: record?.mutantId,
    run: record?.run,
    cleanup: record?.cleanup
  });
  for (const error of pidEvidence.errors) errors.push(`${candidate}: ${error}`);

  return { valid: errors.length === 0, errors };
}

export function assessStoredFormalRecordCurrentCompatibility(record, cleanupSupport = FORMAL_CLEANUP_SUPPORT) {
  const errors = [];
  const candidate = record?.candidate ?? 'unknown candidate';

  if (!lifecycleQualificationRecordProvenanceValid(
    record?.setup?.environment?.formalLifecycleQualification,
    record?.candidate
  )) {
    errors.push(`${candidate}: stored formal record lifecycle qualification bundle differs from current qualification bundle`);
  }

  if (!formalPromotionPolicyProvenanceValid(record?.setup?.environment?.formalPromotionPolicy)) {
    errors.push(`${candidate}: stored formal record promotion policy differs from current frozen promotion policy`);
  }

  if (record?.setup?.status === 'READY') {
    const candidateBinding = assessCandidateProfileBinding(record);
    for (const error of candidateBinding.errors) {
      errors.push(`${candidate}: READY stored formal record candidate profile differs from current frozen candidate profile: ${error}`);
    }

    const runtimeIdentityBinding = assessLifecycleRuntimeIdentityBinding(record, cleanupSupport, record?.candidate);
    for (const error of runtimeIdentityBinding.errors) {
      errors.push(`${candidate}: READY stored formal record lifecycle runtime identity differs from current runtime-verified cleanup support: ${error}`);
    }
  }

  return { compatible: errors.length === 0, errors };
}

export function auditStoredFormalLedger(records) {
  if (!Array.isArray(records)) return { valid: false, recordCount: 0, errors: ['records must be an array'] };
  const errors = [];
  for (let index = 0; index < records.length; index += 1) {
    const audit = auditStoredFormalRecord(records[index]);
    for (const error of audit.errors) errors.push(`ledger index ${index}: ${error}`);
  }
  return { valid: errors.length === 0, recordCount: records.length, errors };
}

export function assessStoredFormalLedgerCurrentCompatibility(records, cleanupSupport = FORMAL_CLEANUP_SUPPORT) {
  if (!Array.isArray(records)) return { compatible: false, recordCount: 0, errors: ['records must be an array'] };
  const errors = [];
  for (let index = 0; index < records.length; index += 1) {
    const assessment = assessStoredFormalRecordCurrentCompatibility(records[index], cleanupSupport);
    for (const error of assessment.errors) errors.push(`ledger index ${index}: ${error}`);
  }
  return { compatible: errors.length === 0, recordCount: records.length, errors };
}

export function assessStoredFormalLedgerRepositoryRevisionConsistency(records) {
  if (!Array.isArray(records)) {
    return { consistent: false, recordCount: 0, repositoryRevision: null, repositoryRevisions: [], errors: ['records must be an array'] };
  }
  const repositoryRevisions = [...new Set(records
    .map((record) => record?.setup?.environment?.repositoryProvenance)
    .filter((value) => repositoryProvenanceReady(value))
    .map((value) => String(value.revision).toLowerCase()))].sort();
  const consistent = repositoryRevisions.length <= 1;
  return {
    consistent,
    recordCount: records.length,
    repositoryRevision: repositoryRevisions.length === 1 ? repositoryRevisions[0] : null,
    repositoryRevisions,
    errors: consistent
      ? []
      : [`formal ledger prefix spans multiple Git repository revisions: ${repositoryRevisions.join(', ')}`]
  };
}

export function assessStoredFormalLedgerHarnessConsistency(records) {
  if (!Array.isArray(records)) {
    return { consistent: false, recordCount: 0, harnessSha256: null, harnessSha256s: [], errors: ['records must be an array'] };
  }
  const harnessSha256s = [...new Set(records
    .map((record) => record?.setup?.harnessSha256)
    .filter((value) => sha256(value))
    .map((value) => String(value).toLowerCase()))].sort();
  const consistent = harnessSha256s.length <= 1;
  return {
    consistent,
    recordCount: records.length,
    harnessSha256: harnessSha256s.length === 1 ? harnessSha256s[0] : null,
    harnessSha256s,
    errors: consistent
      ? []
      : [`formal ledger prefix spans multiple harness identities: ${harnessSha256s.join(', ')}`]
  };
}

export function assessStoredFormalLedgerEnvironmentConsistency(records) {
  return assessFormalEnvironmentConsistency(records);
}

export function formalLedgerAdmission(record, cleanupSupport = FORMAL_CLEANUP_SUPPORT) {
  const errors = [];
  const candidate = record?.candidate;
  if (!candidate || !formalCleanupSupportsCandidate(cleanupSupport, candidate)) {
    errors.push(`${candidate ?? 'unknown candidate'}: formal cleanup support is not runtime-verified`);
  }

  const historical = auditStoredFormalRecord(record);
  errors.push(...historical.errors);

  const compatibility = assessStoredFormalRecordCurrentCompatibility(record, cleanupSupport);
  errors.push(...compatibility.errors);

  return { valid: errors.length === 0, errors };
}

export function validateExecutionLedger(records, protocol, faultSuite, { allowPrefix = true } = {}) {
  const errors = [];
  if (!Array.isArray(records)) return { valid: false, complete: false, errors: ['records must be an array'], nextExpectedExperiment: null };

  const plan = buildExecutionPlan(protocol, faultSuite);
  if (records.length > plan.length) errors.push(`ledger has ${records.length} records but preregistered plan has only ${plan.length}`);
  if (!allowPrefix && records.length !== plan.length) errors.push(`ledger must contain exactly ${plan.length} records, found ${records.length}`);

  const seenIds = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const spec = plan[index];
    if (!spec) break;

    if (seenIds.has(record?.experimentId)) errors.push(`ledger index ${index}: duplicate experimentId ${record?.experimentId}`);
    if (record?.experimentId) seenIds.add(record.experimentId);

    const validation = validateRecordAgainstSpec(record, spec);
    if (!validation.valid) {
      for (const error of validation.errors) errors.push(`ledger index ${index}: ${error}`);
    }

    if (!sameIdentity(record, spec)) {
      const later = plan.findIndex((entry, planIndex) => planIndex > index && sameIdentity(record, entry));
      if (later >= 0) errors.push(`ledger index ${index}: out-of-order record belongs at preregistered index ${later}`);
    }
  }

  const complete = records.length === plan.length && errors.length === 0;
  const nextExpectedExperiment = records.length < plan.length ? plan[records.length] : null;

  return {
    valid: errors.length === 0,
    complete,
    recordCount: records.length,
    expectedRecordCount: plan.length,
    nextExpectedExperiment,
    errors
  };
}

export function appendRecordToLedger(
  records,
  record,
  protocol,
  faultSuite,
  { cleanupSupport = FORMAL_CLEANUP_SUPPORT } = {}
) {
  const current = validateExecutionLedger(records, protocol, faultSuite, { allowPrefix: true });
  if (!current.valid) throw new Error(`existing ledger is invalid: ${current.errors.join('; ')}`);

  const currentHistoricalAudit = auditStoredFormalLedger(records);
  if (!currentHistoricalAudit.valid) {
    throw new Error(`existing formal ledger historical provenance is invalid: ${currentHistoricalAudit.errors.join('; ')}`);
  }

  const currentCompatibility = assessStoredFormalLedgerCurrentCompatibility(records, cleanupSupport);
  if (!currentCompatibility.compatible) {
    throw new Error(`existing formal ledger is incompatible with current frozen qualification/promotion state: ${currentCompatibility.errors.join('; ')}`);
  }

  const currentRevisionConsistency = assessStoredFormalLedgerRepositoryRevisionConsistency(records);
  if (!currentRevisionConsistency.consistent) {
    throw new Error(`existing formal ledger cannot continue across repository revisions: ${currentRevisionConsistency.errors.join('; ')}`);
  }

  const currentHarnessConsistency = assessStoredFormalLedgerHarnessConsistency(records);
  if (!currentHarnessConsistency.consistent) {
    throw new Error(`existing formal ledger cannot continue across harness identities: ${currentHarnessConsistency.errors.join('; ')}`);
  }

  const currentEnvironmentConsistency = assessStoredFormalLedgerEnvironmentConsistency(records);
  if (!currentEnvironmentConsistency.consistent) {
    throw new Error(`existing formal ledger cannot continue across environment identities: ${currentEnvironmentConsistency.errors.join('; ')}`);
  }

  if (!current.nextExpectedExperiment) throw new Error('preregistered ledger is already complete');

  const validation = validateRecordAgainstSpec(record, current.nextExpectedExperiment);
  if (!validation.valid) throw new Error(`record is not the next preregistered experiment: ${validation.errors.join('; ')}`);

  const admission = formalLedgerAdmission(record, cleanupSupport);
  if (!admission.valid) throw new Error(`record is not eligible for formal ledger admission: ${admission.errors.join('; ')}`);

  const next = [...records, record];
  const nextValidation = validateExecutionLedger(next, protocol, faultSuite, { allowPrefix: true });
  if (!nextValidation.valid) throw new Error(`appended ledger is invalid: ${nextValidation.errors.join('; ')}`);

  const nextHistoricalAudit = auditStoredFormalLedger(next);
  if (!nextHistoricalAudit.valid) {
    throw new Error(`appended formal ledger historical provenance is invalid: ${nextHistoricalAudit.errors.join('; ')}`);
  }

  const nextCompatibility = assessStoredFormalLedgerCurrentCompatibility(next, cleanupSupport);
  if (!nextCompatibility.compatible) {
    throw new Error(`appended formal ledger is incompatible with current frozen qualification/promotion state: ${nextCompatibility.errors.join('; ')}`);
  }

  const nextRevisionConsistency = assessStoredFormalLedgerRepositoryRevisionConsistency(next);
  if (!nextRevisionConsistency.consistent) {
    throw new Error(`appended formal ledger would mix repository revisions: ${nextRevisionConsistency.errors.join('; ')}`);
  }

  const nextHarnessConsistency = assessStoredFormalLedgerHarnessConsistency(next);
  if (!nextHarnessConsistency.consistent) {
    throw new Error(`appended formal ledger would mix harness identities: ${nextHarnessConsistency.errors.join('; ')}`);
  }

  const nextEnvironmentConsistency = assessStoredFormalLedgerEnvironmentConsistency(next);
  if (!nextEnvironmentConsistency.consistent) {
    throw new Error(`appended formal ledger would mix environment identities: ${nextEnvironmentConsistency.errors.join('; ')}`);
  }

  return {
    records: next,
    validation: nextValidation,
    formalAudit: nextHistoricalAudit,
    currentCompatibility: nextCompatibility,
    repositoryRevisionConsistency: nextRevisionConsistency,
    harnessConsistency: nextHarnessConsistency,
    environmentConsistency: nextEnvironmentConsistency
  };
}
