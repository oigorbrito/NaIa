function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateT5Evidence(evidence) {
  const checks = {
    oldWorkerConcrete: nonEmpty(evidence?.oldWorkerIdentity),
    newWorkerConcrete: nonEmpty(evidence?.newWorkerIdentity),
    workersDistinct:
      nonEmpty(evidence?.oldWorkerIdentity) &&
      nonEmpty(evidence?.newWorkerIdentity) &&
      evidence.oldWorkerIdentity !== evidence.newWorkerIdentity,
    oldAuthorityConcrete: nonEmpty(evidence?.oldAuthorityIdentity),
    newAuthorityConcrete: nonEmpty(evidence?.newAuthorityIdentity),
    authoritiesDistinct:
      nonEmpty(evidence?.oldAuthorityIdentity) &&
      nonEmpty(evidence?.newAuthorityIdentity) &&
      evidence.oldAuthorityIdentity !== evidence.newAuthorityIdentity,
    authorityAdvanced: evidence?.authorityAdvanced === true,
    oldAuthorityHeldUntilTakeover: evidence?.oldAuthorityHeldUntilTakeover === true,
    staleCompletionActuallyAttempted: evidence?.staleCompletion?.attempted === true,
    staleAttemptBeforeNewCompletion: evidence?.staleCompletion?.attemptedBeforeNewCompletion === true,
    staleCompletionRejectedOrNonAuthoritative: evidence?.staleCompletion?.rejectedOrNonAuthoritative === true,
    staleNeverBecameAuthoritative: evidence?.staleCompletion?.becameAuthoritative === false,
    newAuthorityStillCurrentAfterStaleAttempt: evidence?.newAuthorityStillCurrentAfterStaleAttempt === true,
    newAuthorityCompletionAccepted:
      evidence?.newAuthorityCompletion?.attempted === true &&
      evidence?.newAuthorityCompletion?.acceptedOrAuthoritative === true,
    finalAuthorityIsNew: evidence?.finalAuthorityIdentity === evidence?.newAuthorityIdentity,
    finalResultOriginIsNew: evidence?.finalResultOrigin === 'new-authority',
    durableAuthorityAlive: evidence?.durableAuthorityAlive === true,
    deterministicScheduleObserved: evidence?.deterministicScheduleObserved === true
  };

  return {
    mutantId: 'T5',
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  };
}

export function controlResultToT5Evidence(controlResult) {
  const staleBecameAuthoritative =
    controlResult.stateAfterStaleAttempt?.authoritativeCompletion?.ownerId === controlResult.oldOwner.ownerId;
  return {
    oldWorkerIdentity: 'control-worker-A',
    newWorkerIdentity: 'control-worker-B',
    oldAuthorityIdentity: `${controlResult.oldOwner.ownerId}:${controlResult.oldOwner.token}`,
    newAuthorityIdentity: `${controlResult.newOwner.ownerId}:${controlResult.newOwner.token}`,
    authorityAdvanced: controlResult.newOwner.token > controlResult.oldOwner.token,
    oldAuthorityHeldUntilTakeover: true,
    staleCompletion: {
      attempted: true,
      attemptedBeforeNewCompletion: true,
      rejectedOrNonAuthoritative: controlResult.staleCompletion.accepted === false,
      becameAuthoritative: staleBecameAuthoritative
    },
    newAuthorityStillCurrentAfterStaleAttempt:
      controlResult.stateAfterStaleAttempt?.currentOwner === controlResult.newOwner.ownerId &&
      controlResult.stateAfterStaleAttempt?.currentToken === controlResult.newOwner.token &&
      !staleBecameAuthoritative,
    newAuthorityCompletion: {
      attempted: true,
      acceptedOrAuthoritative: controlResult.currentCompletion.accepted === true
    },
    finalAuthorityIdentity:
      controlResult.finalState.authoritativeCompletion
        ? `${controlResult.finalState.authoritativeCompletion.ownerId}:${controlResult.finalState.authoritativeCompletion.token}`
        : null,
    finalResultOrigin:
      controlResult.finalState.authoritativeCompletion?.ownerId === controlResult.newOwner.ownerId
        ? 'new-authority'
        : 'old-authority',
    durableAuthorityAlive: true,
    deterministicScheduleObserved: Array.isArray(controlResult.schedule) && controlResult.schedule.length === 6,
    rawNativeEvidence: { controlResult, syntheticControlWorkerIdentities: true }
  };
}
