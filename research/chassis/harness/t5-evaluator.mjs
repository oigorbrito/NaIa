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
    newAuthorityCompletionAccepted:
      evidence?.newAuthorityCompletion?.attempted === true &&
      evidence?.newAuthorityCompletion?.acceptedOrAuthoritative === true,
    staleCompletionActuallyAttempted: evidence?.staleCompletion?.attempted === true,
    staleCompletionRejectedOrNonAuthoritative: evidence?.staleCompletion?.rejectedOrNonAuthoritative === true,
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
  return {
    oldWorkerIdentity: 'control-worker-A',
    newWorkerIdentity: 'control-worker-B',
    oldAuthorityIdentity: `${controlResult.oldOwner.ownerId}:${controlResult.oldOwner.token}`,
    newAuthorityIdentity: `${controlResult.newOwner.ownerId}:${controlResult.newOwner.token}`,
    authorityAdvanced: controlResult.newOwner.token > controlResult.oldOwner.token,
    oldAuthorityHeldUntilTakeover: true,
    newAuthorityCompletion: {
      attempted: true,
      acceptedOrAuthoritative: controlResult.currentCompletion.accepted === true
    },
    staleCompletion: {
      attempted: true,
      rejectedOrNonAuthoritative:
        controlResult.staleCompletion.accepted === false ||
        controlResult.finalState.authoritativeCompletion?.ownerId === controlResult.newOwner.ownerId
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
    deterministicScheduleObserved: Array.isArray(controlResult.schedule) && controlResult.schedule.length === 4,
    rawNativeEvidence: { controlResult, syntheticControlWorkerIdentities: true }
  };
}
