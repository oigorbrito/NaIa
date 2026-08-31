function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateT12Evidence(evidence) {
  const checks = {
    oldAuthorityConcrete: nonEmpty(evidence?.oldAuthorityIdentity),
    newAuthorityConcrete: nonEmpty(evidence?.newAuthorityIdentity),
    authoritiesDistinct:
      nonEmpty(evidence?.oldAuthorityIdentity) &&
      nonEmpty(evidence?.newAuthorityIdentity) &&
      evidence.oldAuthorityIdentity !== evidence.newAuthorityIdentity,
    authorityAdvanced: evidence?.authorityAdvanced === true,
    oldCompletionHeldUntilNewCommit: evidence?.oldCompletionHeldUntilNewCommit === true,
    newAuthorityCompletionAccepted:
      evidence?.newAuthorityCompletion?.attempted === true &&
      evidence?.newAuthorityCompletion?.acceptedOrAuthoritative === true,
    staleCompletionActuallyAttempted: evidence?.staleCompletion?.attempted === true,
    staleCompletionAfterNewCommit: evidence?.staleCompletion?.attemptedAfterNewCommit === true,
    staleCompletionRejectedOrNonAuthoritative: evidence?.staleCompletion?.rejectedOrNonAuthoritative === true,
    staleCompletionNeverAuthoritative: evidence?.staleCompletion?.becameAuthoritative === false,
    finalAuthorityIsNew: evidence?.finalAuthorityIdentity === evidence?.newAuthorityIdentity,
    finalResultOriginIsNew: evidence?.finalResultOrigin === 'new-authority',
    durableAuthorityAlive: evidence?.durableAuthorityAlive === true,
    deterministicScheduleObserved: evidence?.deterministicScheduleObserved === true
  };

  return {
    mutantId: 'T12',
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  };
}
