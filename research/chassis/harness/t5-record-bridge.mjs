import { evaluateT5Evidence } from './t5-evaluator.mjs';

export function t5EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT5Evidence(evidence);
  const injected =
    evidence?.authorityAdvanced === true &&
    evidence?.newAuthorityCompletion?.attempted === true &&
    evidence?.staleCompletion?.attempted === true &&
    evaluation.checks.workersDistinct === true &&
    evaluation.checks.authoritiesDistinct === true;

  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T5',
      injected,
      targetKind: 'stale-worker-authority',
      targetIdentity: evidence?.oldWorkerIdentity ?? null,
      signal: null,
      durableAuthorityAlive: evidence?.durableAuthorityAlive === true
    },
    workload: {
      experimentId: spec?.experimentId ?? null,
      objectiveId: evidence?.rawNativeEvidence?.objectiveId ?? null
    },
    rawObservations: {
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
