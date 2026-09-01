import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExperimentRecord } from './experiment-record-validator.mjs';
import { explicitWorkerProcessPids } from './formal-worker-pid-provenance.mjs';

const CLEANUP_DIMENSIONS = Object.freeze([
  'workerCleanup',
  'durableStateCleanup',
  'oracleCleanup',
  'temporaryResourcesCleanup'
]);

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function allCleanupDimensionsTrue(value) {
  return CLEANUP_DIMENSIONS.every((key) => value?.[key] === true);
}

function candidateSpecificChecks(record) {
  const cleanup = record?.cleanup ?? {};
  if (record?.candidate === 'Temporal TypeScript') {
    return {
      temporalServerCleanup: cleanup.temporalServerCleanup === true,
      sqliteCleanup: cleanup.sqliteCleanup === true,
      workspaceCleanup: cleanup.workspaceCleanup === true
    };
  }
  if (record?.candidate === 'DBOS TypeScript') {
    return {
      cleanupContainerAllowed: cleanup.cleanupContainerAllowed === true,
      databaseDrop: cleanup.databaseDrop === true,
      databaseAbsent: cleanup.databaseAbsent === true,
      postgresContainerCleanup: cleanup.postgresContainerCleanup === true,
      workspaceCleanup: cleanup.workspaceCleanup === true
    };
  }
  return { supportedCandidate: false };
}

export function validateRuntimeLifecycleReceipt(record) {
  const schema = validateExperimentRecord(record);
  const preRun = record?.setup?.preRunCleanupReceipt ?? null;
  const cleanup = record?.cleanup ?? null;
  const lifecycle = record?.setup?.environment?.formalRuntimeLifecycle ?? null;
  const workerProcessPids = explicitWorkerProcessPids(record?.run);
  const observedWorkerPids = cleanup?.observedWorkerPids ?? [];
  const liveObservedWorkerPids = cleanup?.liveObservedWorkerPids ?? [];
  const specific = candidateSpecificChecks(record);

  const checks = {
    schemaValid: schema.valid,
    supportedCandidate: ['Temporal TypeScript', 'DBOS TypeScript'].includes(record?.candidate),
    firstPreregisteredMutant: record?.mutantId === 'T5',
    firstRepetition: record?.repetition === 1,
    setupReady: record?.setup?.status === 'READY',
    cleanupVerifiedBeforeRun: record?.setup?.cleanupVerifiedBeforeRun === true,
    lifecycleDeclared: lifecycle?.candidate === record?.candidate,
    lifecycleStateIsPrePromotionOrVerified: ['IMPLEMENTED_NOT_RUNTIME_VERIFIED', 'RUNTIME_VERIFIED'].includes(lifecycle?.status),
    preRunReceiptPass: preRun?.status === 'PASS',
    preRunCleanupDimensionsPass: allCleanupDimensionsTrue(preRun),
    intendedFaultInjected: record?.run?.fault?.injected === true,
    concreteFaultTarget: Boolean(record?.run?.fault?.targetKind) && record?.run?.fault?.targetIdentity !== null && record?.run?.fault?.targetIdentity !== undefined && record?.run?.fault?.targetIdentity !== '',
    durableAuthorityAlive: record?.run?.fault?.durableAuthorityAlive === true,
    explicitWorkerProcessPidsPresent: workerProcessPids.length > 0,
    observedWorkerPidsPresent: nonEmptyArray(observedWorkerPids),
    explicitWorkerPidsIncludedInCleanupObservation: workerProcessPids.every((pid) => observedWorkerPids.includes(pid)),
    noObservedWorkerPidAliveAfterCleanup: Array.isArray(liveObservedWorkerPids) && liveObservedWorkerPids.length === 0,
    cleanupPass: cleanup?.status === 'PASS',
    cleanupDimensionsPass: allCleanupDimensionsTrue(cleanup),
    ...specific
  };

  const eligibleForLifecycleStatusPromotion = Object.values(checks).every(Boolean);
  return {
    valid: schema.valid,
    candidate: record?.candidate ?? null,
    mutantId: record?.mutantId ?? null,
    repetition: record?.repetition ?? null,
    candidateVerdict: record?.verdict ?? null,
    candidateVerdictIgnoredForLifecycleVerification: true,
    workerProcessPids,
    checks,
    schemaErrors: schema.errors,
    eligibleForLifecycleStatusPromotion,
    benchmarkPromotionAllowed: false,
    ledgerAppendAllowed: false,
    disposition: eligibleForLifecycleStatusPromotion
      ? 'RUNTIME_LIFECYCLE_RECEIPT_QUALIFIES_FOR_SEPARATE_PROMOTION_REVIEW'
      : 'RUNTIME_LIFECYCLE_RECEIPT_NOT_SUFFICIENT'
  };
}

async function main() {
  const recordPath = process.argv[2];
  if (!recordPath) throw new Error('usage: node formal-lifecycle-runtime-receipt-validator.mjs <record.json>');
  const record = JSON.parse(await readFile(path.resolve(recordPath), 'utf8'));
  const result = validateRuntimeLifecycleReceipt(record);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.eligibleForLifecycleStatusPromotion) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 3;
  });
}
