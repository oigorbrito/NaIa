import { evaluateT5Evidence } from './t5-evaluator.mjs';
import { normalizeWorkerProcessPids } from './formal-worker-pid-provenance.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function t5FaultStimulusObserved(evidence) {
  const workersDistinct =
    nonEmpty(evidence?.oldWorkerIdentity) &&
    nonEmpty(evidence?.newWorkerIdentity) &&
    evidence.oldWorkerIdentity !== evidence.newWorkerIdentity;
  const authoritiesDistinct =
    nonEmpty(evidence?.oldAuthorityIdentity) &&
    nonEmpty(evidence?.newAuthorityIdentity) &&
    evidence.oldAuthorityIdentity !== evidence.newAuthorityIdentity;

  return Boolean(
    evidence?.authorityAdvanced === true &&
    evidence?.staleCompletion?.attempted === true &&
    evidence?.staleCompletion?.attemptedBeforeNewCompletion === true &&
    evidence?.newAuthorityCompletion?.attempted === true &&
    workersDistinct &&
    authoritiesDistinct
  );
}

export function t5EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT5Evidence(evidence);
  const injected = t5FaultStimulusObserved(evidence);
  const workerProcessPids = normalizeWorkerProcessPids(
    evidence?.rawNativeEvidence?.workerA?.pid,
    evidence?.rawNativeEvidence?.workerB?.pid
  );

  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T5',
      injected,
      targetKind: 'concurrent-worker-ownership-race',
      targetIdentity: evidence?.oldWorkerIdentity ?? null,
      signal: null,
      durableAuthorityAlive: evidence?.durableAuthorityAlive === true
    },
    workload: {
      experimentId: spec?.experimentId ?? null,
      objectiveId: evidence?.rawNativeEvidence?.objectiveId ?? null
    },
    rawObservations: {
      workerProcessPids,
      t5Evidence: evidence,
      t5Evaluation: evaluation,
      setupIdentity: {
        adapterSha256: setup?.adapterSha256 ?? null,
        harnessSha256: setup?.harnessSha256 ?? null
      }
    },
    acceptanceChecks: evaluation.checks
  };
}
