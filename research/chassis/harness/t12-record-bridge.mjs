import { evaluateT12Evidence } from './t12-evaluator.mjs';
import { normalizeWorkerProcessPids } from './formal-worker-pid-provenance.mjs';

export function t12EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT12Evidence(evidence);
  const injected =
    evaluation.checks.authoritiesDistinct === true &&
    evidence?.authorityAdvanced === true &&
    evidence?.newAuthorityCompletion?.attempted === true &&
    evidence?.newAuthorityCompletion?.acceptedOrAuthoritative === true &&
    evidence?.staleCompletion?.attempted === true &&
    evidence?.staleCompletion?.attemptedAfterNewCommit === true;
  const workerProcessPids = normalizeWorkerProcessPids(
    evidence?.rawNativeEvidence?.workerA?.pid,
    evidence?.rawNativeEvidence?.workerB?.pid
  );

  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T12',
      injected,
      targetKind: 'stale-completion-authority',
      targetIdentity: evidence?.oldAuthorityIdentity ?? null,
      signal: null,
      durableAuthorityAlive: evidence?.durableAuthorityAlive === true
    },
    workload: {
      experimentId: spec?.experimentId ?? null,
      objectiveId: evidence?.rawNativeEvidence?.objectiveId ?? null
    },
    rawObservations: {
      workerProcessPids,
      t12Evidence: evidence,
      t12Evaluation: evaluation,
      setupIdentity: {
        adapterSha256: setup?.adapterSha256 ?? null,
        harnessSha256: setup?.harnessSha256 ?? null
      }
    },
    acceptanceChecks: evaluation.checks
  };
}
