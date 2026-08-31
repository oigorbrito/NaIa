export function createT5OwnershipControl({ enforceFencing = true } = {}) {
  const objectives = new Map();

  function stateFor(objectiveId) {
    let state = objectives.get(objectiveId);
    if (!state) {
      state = {
        objectiveId,
        nextToken: 1,
        currentOwner: null,
        currentToken: null,
        highestAcceptedToken: 0,
        authoritativeCompletion: null,
        acquisitions: [],
        completionAttempts: []
      };
      objectives.set(objectiveId, state);
    }
    return state;
  }

  function acquire(objectiveId, ownerId) {
    if (!objectiveId || !ownerId) throw new Error('objectiveId and ownerId are required');
    const state = stateFor(objectiveId);
    const token = state.nextToken++;
    state.currentOwner = ownerId;
    state.currentToken = token;
    state.acquisitions.push({ ownerId, token });
    return { objectiveId, ownerId, token };
  }

  function complete(objectiveId, ownerId, token, value) {
    const state = stateFor(objectiveId);
    const staleByOwnership = ownerId !== state.currentOwner || token !== state.currentToken;
    const staleByFence = token < state.highestAcceptedToken;
    const stale = staleByOwnership || staleByFence;
    const accepted = enforceFencing ? !stale : true;
    const attempt = {
      ownerId,
      token,
      value,
      stale,
      accepted,
      reason: accepted ? null : 'STALE_AUTHORITY_REJECTED'
    };
    state.completionAttempts.push(attempt);
    if (accepted) {
      state.highestAcceptedToken = Math.max(state.highestAcceptedToken, token);
      state.authoritativeCompletion = { ownerId, token, value };
    }
    return structuredClone(attempt);
  }

  function snapshot(objectiveId) {
    const state = objectives.get(objectiveId);
    return state ? structuredClone(state) : null;
  }

  return { acquire, complete, snapshot, enforceFencing };
}

export function executeDeterministicT5Control({ unsafe = false, objectiveId = 't5-control-objective' } = {}) {
  const authority = createT5OwnershipControl({ enforceFencing: !unsafe });
  const oldOwner = authority.acquire(objectiveId, 'owner-A');
  const newOwner = authority.acquire(objectiveId, 'owner-B');

  const currentCompletion = authority.complete(objectiveId, newOwner.ownerId, newOwner.token, 'new-owner-result');
  const staleCompletion = authority.complete(objectiveId, oldOwner.ownerId, oldOwner.token, 'stale-owner-result');
  const finalState = authority.snapshot(objectiveId);

  const checks = {
    ownershipAdvanced: newOwner.token > oldOwner.token,
    currentOwnerCompletionAccepted: currentCompletion.accepted === true,
    staleCompletionAttempted: staleCompletion.stale === true,
    staleCompletionRejected: staleCompletion.accepted === false,
    staleAttemptCannotOverwriteCurrentAuthority:
      finalState.authoritativeCompletion?.ownerId === newOwner.ownerId &&
      finalState.authoritativeCompletion?.token === newOwner.token &&
      finalState.authoritativeCompletion?.value === 'new-owner-result'
  };

  return {
    mutantId: 'T5',
    schedule: [
      'owner-A acquires authority',
      'owner-B acquires newer authority',
      'owner-B completes',
      'owner-A submits late stale completion'
    ],
    oldOwner,
    newOwner,
    currentCompletion,
    staleCompletion,
    finalState,
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL'
  };
}
