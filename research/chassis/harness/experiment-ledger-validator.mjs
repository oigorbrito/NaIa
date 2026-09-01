import { buildExecutionPlan } from './experiment-executor.mjs';
import { validateExperimentRecord } from './experiment-record-validator.mjs';
import { FORMAL_CLEANUP_SUPPORT, formalCleanupSupportsCandidate } from './formal-cleanup-support.mjs';
import { explicitWorkerProcessPids, workerPidProvenanceRequired } from './formal-worker-pid-provenance.mjs';

function sameIdentity(record, spec) {
  return record?.experimentId === spec.experimentId
    && record?.candidate === spec.candidate
    && record?.mutantId === spec.mutantId
    && record?.repetition === spec.repetition
    && record?.randomSeed === spec.randomSeed;
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

export function formalLedgerAdmission(record, cleanupSupport = FORMAL_CLEANUP_SUPPORT) {
  const errors = [];
  const candidate = record?.candidate;
  if (!candidate || !formalCleanupSupportsCandidate(cleanupSupport, candidate)) {
    errors.push(`${candidate ?? 'unknown candidate'}: formal cleanup support is not runtime-verified`);
  }

  const lifecycle = record?.setup?.environment?.formalRuntimeLifecycle;
  if (!lifecycle || lifecycle.candidate !== candidate || lifecycle.status !== 'RUNTIME_VERIFIED') {
    errors.push(`${candidate ?? 'unknown candidate'}: record lacks RUNTIME_VERIFIED formal runtime lifecycle provenance`);
  }

  if (record?.setup?.status === 'READY' && record?.cleanup?.status !== 'PASS') {
    errors.push(`${candidate ?? 'unknown candidate'}: READY formal execution requires cleanup.status=PASS`);
  }

  const pidProvenanceRequired = workerPidProvenanceRequired({
    setupStatus: record?.setup?.status,
    mutantId: record?.mutantId,
    run: record?.run
  });
  if (pidProvenanceRequired && explicitWorkerProcessPids(record?.run).length === 0) {
    errors.push(`${candidate ?? 'unknown candidate'}: injected critical formal execution lacks explicit worker process PID provenance`);
  }

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

export function appendRecordToLedger(records, record, protocol, faultSuite) {
  const current = validateExecutionLedger(records, protocol, faultSuite, { allowPrefix: true });
  if (!current.valid) throw new Error(`existing ledger is invalid: ${current.errors.join('; ')}`);
  if (!current.nextExpectedExperiment) throw new Error('preregistered ledger is already complete');

  const validation = validateRecordAgainstSpec(record, current.nextExpectedExperiment);
  if (!validation.valid) throw new Error(`record is not the next preregistered experiment: ${validation.errors.join('; ')}`);

  const admission = formalLedgerAdmission(record);
  if (!admission.valid) throw new Error(`record is not eligible for formal ledger admission: ${admission.errors.join('; ')}`);

  const next = [...records, record];
  const nextValidation = validateExecutionLedger(next, protocol, faultSuite, { allowPrefix: true });
  if (!nextValidation.valid) throw new Error(`appended ledger is invalid: ${nextValidation.errors.join('; ')}`);
  return { records: next, validation: nextValidation };
}
