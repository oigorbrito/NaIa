import { evaluateT16Evidence } from './t16-evaluator.mjs';

export function t16EvidenceToRunResult(evidence, spec, setup) {
  const evaluation = evaluateT16Evidence(evidence);
  const mutation = evidence?.semanticMutation ?? null;
  const disposition = evidence?.compatibilityDisposition ?? null;
  const injected =
    evidence?.durableCheckpointBeforeMutation === true &&
    evidence?.recoveryAttemptedUnderMutatedProfile === true &&
    mutation?.before !== mutation?.after &&
    mutation?.before !== undefined &&
    mutation?.after !== undefined;

  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T16',
      injected,
      targetKind: 'semantic-profile-recovery',
      targetIdentity: evidence?.objectiveIdentity ?? null,
      signal: null,
      durableAuthorityAlive: evidence?.durableAuthorityAlive === true
    },
    workload: {
      experimentId: spec?.experimentId ?? null,
      objectiveId: evidence?.objectiveIdentity ?? null
    },
    rawObservations: {
      semanticMutation: mutation,
      compatibilityDisposition: disposition,
      t16Evidence: evidence,
      t16Evaluation: evaluation,
      setupIdentity: {
        adapterSha256: setup?.adapterSha256 ?? null,
        harnessSha256: setup?.harnessSha256 ?? null
      }
    },
    acceptanceChecks: evaluation.checks
  };
}
