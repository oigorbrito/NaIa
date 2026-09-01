import { evaluateT11Evidence } from './t11-evaluator.mjs';
import { normalizeWorkerProcessPids } from './formal-worker-pid-provenance.mjs';

export function t11EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT11Evidence(evidence);
  const injected =
    evidence?.cancelAuthority?.durable === true &&
    evidence?.crash?.injected === true &&
    evidence?.recovery?.attempted === true;
  const workerProcessPids = normalizeWorkerProcessPids(
    evidence?.rawNativeEvidence?.workerA?.pid,
    evidence?.rawNativeEvidence?.workerB?.pid
  );

  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T11',
      injected,
      targetKind: 'cancelled-worker-process',
      targetIdentity: evidence?.oldWorkerIdentity ?? null,
      signal: evidence?.crash?.signal ?? null,
      durableAuthorityAlive: evidence?.durableAuthorityAlive === true
    },
    workload: {
      experimentId: spec?.experimentId ?? null,
      objectiveId: evidence?.objectiveIdentity ?? null
    },
    rawObservations: {
      workerProcessPids,
      t11Evidence: evidence,
      t11Evaluation: evaluation,
      setupIdentity: {
        adapterSha256: setup?.adapterSha256 ?? null,
        harnessSha256: setup?.harnessSha256 ?? null
      }
    },
    acceptanceChecks: evaluation.checks
  };
}
