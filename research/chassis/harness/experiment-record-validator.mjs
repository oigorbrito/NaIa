import { FORMAL_CLEANUP_SUPPORT, formalCleanupSupportsCandidate } from './formal-cleanup-support.mjs';
import { lifecycleQualificationRecordProvenanceValid } from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenanceValid } from './formal-promotion-policy.mjs';
import { validateExperimentRecord } from './experiment-record-schema-validator.mjs';
import { validateWorkerPidCleanupEvidence } from './formal-worker-pid-provenance.mjs';
import { repositoryProvenanceReady } from './repository-provenance.mjs';

export { validateExperimentRecord } from './experiment-record-schema-validator.mjs';

const CLEANUP_DIMENSIONS = Object.freeze(['workerCleanup', 'durableStateCleanup', 'oracleCleanup', 'temporaryResourcesCleanup']);

function preRunCleanupReceiptValid(receipt) {
  return receipt?.status === 'PASS' && CLEANUP_DIMENSIONS.every((key) => receipt?.[key] === true);
}

export function benchmarkRepositoryRevisions(records) {
  return [...new Set((records ?? [])
    .map((record) => record?.setup?.environment?.repositoryProvenance)
    .filter((value) => repositoryProvenanceReady(value))
    .map((value) => String(value.revision).toLowerCase()))].sort();
}

export function benchmarkEligible(records, faultSuite, cleanupSupport = FORMAL_CLEANUP_SUPPORT) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) return { eligible: false, errors: ['no records'] };
  const candidate = records[0]?.candidate;
  if (!candidate || records.some((record) => record.candidate !== candidate)) errors.push('records must belong to one candidate');
  if (candidate && !formalCleanupSupportsCandidate(cleanupSupport, candidate)) {
    errors.push(`${candidate}: benchmark eligibility requires evidence-backed RUNTIME_VERIFIED formal cleanup support`);
  }

  const repositoryRevisions = benchmarkRepositoryRevisions(records);
  if (repositoryRevisions.length > 1) {
    errors.push(`${candidate ?? 'unknown candidate'}: formal benchmark records span multiple Git repository revisions: ${repositoryRevisions.join(', ')}`);
  }

  const mutants = new Map((faultSuite?.mutants ?? []).map((mutant) => [mutant.id, mutant]));
  const required = new Set(faultSuite?.benchmarkEligibility?.forbidBlockedOrInconclusive ?? []);

  for (const mutantId of required) {
    const mutantRecords = records.filter((record) => record.mutantId === mutantId);
    const minRepetitions = mutants.get(mutantId)?.minRepetitions ?? 1;

    if (mutantRecords.length === 0) {
      errors.push(`${mutantId}: no executed records`);
      continue;
    }

    const repetitionIds = new Set();
    for (const record of mutantRecords) {
      const validation = validateExperimentRecord(record);
      if (!validation.valid) errors.push(`${mutantId}: invalid record: ${validation.errors.join('; ')}`);
      if (['BLOCKED', 'INCONCLUSIVE'].includes(record.verdict)) errors.push(`${mutantId}: benchmark-ineligible verdict ${record.verdict}`);
      if (repetitionIds.has(record.repetition)) errors.push(`${mutantId}: duplicate repetition ${record.repetition}`);
      repetitionIds.add(record.repetition);

      const environment = record?.setup?.environment ?? {};
      const lifecycle = environment.formalRuntimeLifecycle;
      if (!repositoryProvenanceReady(environment.repositoryProvenance)) {
        errors.push(`${mutantId}: repetition ${record.repetition} lacks verified clean Git repository revision provenance`);
      }
      if (!lifecycle || lifecycle.candidate !== candidate || lifecycle.status !== 'RUNTIME_VERIFIED') {
        errors.push(`${mutantId}: repetition ${record.repetition} lacks RUNTIME_VERIFIED formal runtime lifecycle provenance`);
      }
      if (!lifecycleQualificationRecordProvenanceValid(environment.formalLifecycleQualification, candidate)) {
        errors.push(`${mutantId}: repetition ${record.repetition} lacks current candidate lifecycle qualification bundle provenance`);
      }
      if (!formalPromotionPolicyProvenanceValid(environment.formalPromotionPolicy)) {
        errors.push(`${mutantId}: repetition ${record.repetition} lacks current frozen formal promotion policy hash provenance`);
      }
      if (record?.setup?.status === 'READY') {
        if (!preRunCleanupReceiptValid(record?.setup?.preRunCleanupReceipt)) {
          errors.push(`${mutantId}: repetition ${record.repetition} READY execution lacks complete PASS pre-run cleanup receipt`);
        }
        if (record?.cleanup?.status !== 'PASS') {
          errors.push(`${mutantId}: repetition ${record.repetition} READY execution requires cleanup.status=PASS`);
        }
      }

      const pidEvidence = validateWorkerPidCleanupEvidence({
        setupStatus: record?.setup?.status,
        mutantId: record?.mutantId,
        run: record?.run,
        cleanup: record?.cleanup
      });
      for (const error of pidEvidence.errors) {
        errors.push(`${mutantId}: repetition ${record.repetition} ${error}`);
      }
    }

    if (repetitionIds.size < minRepetitions) {
      errors.push(`${mutantId}: requires at least ${minRepetitions} unique repetitions, found ${repetitionIds.size}`);
    }

    for (let repetition = 1; repetition <= minRepetitions; repetition += 1) {
      if (!repetitionIds.has(repetition)) errors.push(`${mutantId}: missing required repetition ${repetition}`);
    }
  }

  return { eligible: errors.length === 0, candidate, errors };
}
