function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const SAFE_DISPOSITIONS = new Set(['REJECTED_INCOMPATIBLE', 'ROUTED_TO_COMPATIBLE', 'EXPLICIT_MIGRATION']);

export function evaluateT16Evidence(evidence) {
  const mutation = evidence?.semanticMutation ?? {};
  const disposition = evidence?.compatibilityDisposition ?? {};
  const safeDisposition = SAFE_DISPOSITIONS.has(disposition.kind);
  const migrationIdentityValid =
    disposition.kind !== 'EXPLICIT_MIGRATION' || nonEmpty(disposition.migrationIdentity);

  const checks = {
    objectiveIdentityConcrete: nonEmpty(evidence?.objectiveIdentity),
    mutationDimensionConcrete: nonEmpty(mutation.dimension),
    mutationBeforeConcrete: mutation.before !== undefined && mutation.before !== null && mutation.before !== '',
    mutationAfterConcrete: mutation.after !== undefined && mutation.after !== null && mutation.after !== '',
    semanticMutationActuallyChanged: mutation.before !== mutation.after,
    durableCheckpointBeforeMutation: evidence?.durableCheckpointBeforeMutation === true,
    recoveryAttemptedUnderMutatedProfile: evidence?.recoveryAttemptedUnderMutatedProfile === true,
    compatibilityDispositionSafeAndExplicit: safeDisposition && disposition.explicit === true,
    explicitMigrationIdentifiedWhenUsed: migrationIdentityValid,
    noSilentSemanticChange: evidence?.silentSemanticChangeObserved === false,
    priorMeaningPreservedOrExplicitlyMigrated: evidence?.priorMeaningPreservedOrExplicitlyMigrated === true,
    durableAuthorityAlive: evidence?.durableAuthorityAlive === true,
    deterministicScheduleObserved: evidence?.deterministicScheduleObserved === true
  };

  return {
    mutantId: 'T16',
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  };
}
