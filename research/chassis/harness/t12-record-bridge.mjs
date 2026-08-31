import { evaluateT12Evidence } from './t12-evaluator.mjs';

export function t12EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT12Evidence(evidence);
  const injected =
    evaluation.checks.authoritiesDistinct === true &&
    evidence?.authorityAdvanced === true &&
    evidence?.newAuthorityCompletion?.attempted === true &&
    evidence?.newAuthorityCompletion?.acceptedOrAuthoritative === true &&
    evidence?.staleCompletion?.attempted === true &&
    evidence?.staleCompletion?.attemptedAfterNewCommit === true;

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
