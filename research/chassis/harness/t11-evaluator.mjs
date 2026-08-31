function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateT11Evidence(evidence) {
  const protectedAttempt = evidence?.postCancelProtectedOperation ?? {};
  const causallyBlocked =
    protectedAttempt.blockedBeforeProtectedOperation === true &&
    protectedAttempt.blockedByNativeCancellation === true;
  const challengedSafely =
    (protectedAttempt.attempted === true && protectedAttempt.accepted === false) ||
    causallyBlocked;

  const checks = {
    objectiveIdentityConcrete: nonEmpty(evidence?.objectiveIdentity),
    oldWorkerConcrete: nonEmpty(evidence?.oldWorkerIdentity),
    recoveryWorkerConcrete: nonEmpty(evidence?.recoveryWorkerIdentity),
    workersDistinct:
      nonEmpty(evidence?.oldWorkerIdentity) &&
      nonEmpty(evidence?.recoveryWorkerIdentity) &&
      evidence.oldWorkerIdentity !== evidence.recoveryWorkerIdentity,
    cancelSubmitted: evidence?.cancelSubmission?.attempted === true,
    cancelAcknowledged: evidence?.cancelSubmission?.acknowledged === true,
    cancelAuthorityDurable: evidence?.cancelAuthority?.durable === true,
    crashInjectedAfterCancelAuthority:
      evidence?.crash?.injected === true &&
      evidence?.crash?.targetIdentity === evidence?.oldWorkerIdentity,
    recoveryAttempted: evidence?.recovery?.attempted === true,
    postCancelBoundaryChallengedSafely: challengedSafely,
    zeroAcceptedProgressAfterCancel: protectedAttempt.acceptedCountAfterCancel === 0,
    finalCancellationAuthoritative: evidence?.finalCancellationAuthoritative === true,
    durableAuthorityAlive: evidence?.durableAuthorityAlive === true,
    deterministicScheduleObserved: evidence?.deterministicScheduleObserved === true
  };

  return {
    mutantId: 'T11',
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  };
}
