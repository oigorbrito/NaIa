export function createT12AuthorityControl({ enforceFencing = true } = {}) {
  const state = {
    objectiveId: null,
    nextGeneration: 1,
    currentAuthority: null,
    authoritativeResult: null,
    completions: []
  };

  function acquire(objectiveId, ownerId) {
    if (!objectiveId || !ownerId) throw new Error('objectiveId and ownerId are required');
    if (state.objectiveId === null) state.objectiveId = objectiveId;
    if (state.objectiveId !== objectiveId) throw new Error('control supports one semantic objective per instance');
    const authority = { objectiveId, ownerId, generation: state.nextGeneration++ };
    state.currentAuthority = authority;
    return structuredClone(authority);
  }

  function complete(authority, value) {
    if (!authority) throw new Error('authority is required');
    const stale =
      state.currentAuthority?.ownerId !== authority.ownerId ||
      state.currentAuthority?.generation !== authority.generation;
    const accepted = enforceFencing ? !stale : true;
    const completion = { authority: structuredClone(authority), value, stale, accepted };
    state.completions.push(completion);
    if (accepted) {
      state.authoritativeResult = { authority: structuredClone(authority), value };
      state.currentAuthority = structuredClone(authority);
    }
    return structuredClone(completion);
  }

  function snapshot() {
    return structuredClone(state);
  }

  return { acquire, complete, snapshot, enforceFencing };
}

export function executeDeterministicT12Control({ unsafe = false, objectiveId = 't12-control-objective' } = {}) {
  const control = createT12AuthorityControl({ enforceFencing: !unsafe });
  const schedule = [];

  const oldAuthority = control.acquire(objectiveId, 'owner-A');
  schedule.push('old-authority-acquired');
  const heldOldCompletion = { authority: oldAuthority, value: 'old-authority-result' };
  schedule.push('old-completion-held');

  const newAuthority = control.acquire(objectiveId, 'owner-B');
  schedule.push('new-authority-acquired');
  const newCompletion = control.complete(newAuthority, 'new-authority-result');
  schedule.push('new-authority-committed');
  const stateAfterNewCommit = control.snapshot();

  const staleCompletion = control.complete(heldOldCompletion.authority, heldOldCompletion.value);
  schedule.push('stale-completion-submitted-after-new-commit');
  const finalState = control.snapshot();
  schedule.push('final-authority-inspected');

  const evidence = {
    oldAuthorityIdentity: `${oldAuthority.ownerId}:${oldAuthority.generation}`,
    newAuthorityIdentity: `${newAuthority.ownerId}:${newAuthority.generation}`,
    authorityAdvanced: newAuthority.generation > oldAuthority.generation,
    oldCompletionHeldUntilNewCommit: true,
    newAuthorityCompletion: {
      attempted: true,
      acceptedOrAuthoritative:
        newCompletion.accepted === true &&
        stateAfterNewCommit.authoritativeResult?.authority?.ownerId === newAuthority.ownerId
    },
    staleCompletion: {
      attempted: true,
      attemptedAfterNewCommit: true,
      rejectedOrNonAuthoritative:
        staleCompletion.accepted === false ||
        finalState.authoritativeResult?.authority?.ownerId === newAuthority.ownerId,
      becameAuthoritative:
        finalState.authoritativeResult?.authority?.ownerId === oldAuthority.ownerId,
      response: staleCompletion
    },
    finalAuthorityIdentity: finalState.authoritativeResult
      ? `${finalState.authoritativeResult.authority.ownerId}:${finalState.authoritativeResult.authority.generation}`
      : null,
    finalResultOrigin:
      finalState.authoritativeResult?.authority?.ownerId === newAuthority.ownerId
        ? 'new-authority'
        : finalState.authoritativeResult?.authority?.ownerId === oldAuthority.ownerId
          ? 'old-authority'
          : null,
    durableAuthorityAlive: true,
    deterministicScheduleObserved: schedule.length === 6,
    rawNativeEvidence: {
      syntheticControl: true,
      objectiveId,
      schedule,
      oldAuthority,
      newAuthority,
      newCompletion,
      stateAfterNewCommit,
      staleCompletion,
      finalState
    }
  };

  return { mutantId: 'T12', evidence };
}
