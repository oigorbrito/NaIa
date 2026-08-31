export function createT11CancelControl({ preserveCancellationOnRecovery = true } = {}) {
  const objectives = new Map();

  function requireState(objectiveId) {
    const state = objectives.get(objectiveId);
    if (!state) throw new Error(`unknown objective: ${objectiveId}`);
    return state;
  }

  function create(objectiveId, workerId) {
    if (!objectiveId || !workerId) throw new Error('objectiveId and workerId are required');
    if (objectives.has(objectiveId)) throw new Error(`objective already exists: ${objectiveId}`);
    const state = {
      objectiveId,
      currentWorker: workerId,
      status: 'RUNNING',
      cancelEpoch: null,
      crashedWorkers: [],
      recoveryAttempts: 0,
      protectedAttempts: [],
      events: ['objective-running']
    };
    objectives.set(objectiveId, state);
    return snapshot(objectiveId);
  }

  function preCancelCheckpoint(objectiveId) {
    const state = requireState(objectiveId);
    state.events.push('pre-cancel-checkpoint');
  }

  function establishCancel(objectiveId) {
    const state = requireState(objectiveId);
    if (state.status !== 'RUNNING') throw new Error(`cannot cancel from ${state.status}`);
    state.events.push('cancel-submitted');
    state.cancelEpoch = (state.cancelEpoch ?? 0) + 1;
    state.status = 'CANCELLED';
    state.events.push('cancel-authority-durable');
    return { objectiveId, cancelEpoch: state.cancelEpoch, status: state.status };
  }

  function crash(objectiveId, workerId) {
    const state = requireState(objectiveId);
    if (workerId !== state.currentWorker) throw new Error('crash target is not current worker');
    state.crashedWorkers.push(workerId);
    state.currentWorker = null;
    state.events.push('worker-crash');
    return { objectiveId, workerId, crashed: true };
  }

  function recover(objectiveId, workerId) {
    const state = requireState(objectiveId);
    state.recoveryAttempts += 1;
    state.currentWorker = workerId;
    if (!preserveCancellationOnRecovery) {
      state.status = 'RUNNING';
      state.cancelEpoch = null;
    }
    state.events.push('recovery-attempted');
    return { objectiveId, workerId, status: state.status, cancelEpoch: state.cancelEpoch };
  }

  function attemptProtectedOperation(objectiveId, workerId, value) {
    const state = requireState(objectiveId);
    const cancellationAuthoritative = state.status === 'CANCELLED' && state.cancelEpoch !== null;
    const accepted = !cancellationAuthoritative;
    const attempt = {
      objectiveId,
      workerId,
      value,
      attempted: true,
      accepted,
      cancelEpochAtAttempt: state.cancelEpoch,
      statusAtAttempt: state.status
    };
    state.protectedAttempts.push(attempt);
    state.events.push('post-cancel-progress-challenged');
    return structuredClone(attempt);
  }

  function inspect(objectiveId) {
    const state = requireState(objectiveId);
    state.events.push('post-recovery-state-inspected');
    return snapshot(objectiveId);
  }

  function snapshot(objectiveId) {
    const state = requireState(objectiveId);
    return structuredClone(state);
  }

  return { create, preCancelCheckpoint, establishCancel, crash, recover, attemptProtectedOperation, inspect, snapshot };
}

export function executeDeterministicT11Control({ unsafe = false, objectiveId = 't11-control-objective' } = {}) {
  const control = createT11CancelControl({ preserveCancellationOnRecovery: !unsafe });
  const oldWorkerIdentity = 'control-worker-A';
  const recoveryWorkerIdentity = 'control-worker-B';

  control.create(objectiveId, oldWorkerIdentity);
  control.preCancelCheckpoint(objectiveId);
  const cancel = control.establishCancel(objectiveId);
  const crash = control.crash(objectiveId, oldWorkerIdentity);
  const recovery = control.recover(objectiveId, recoveryWorkerIdentity);
  const protectedAttempt = control.attemptProtectedOperation(objectiveId, recoveryWorkerIdentity, 'post-cancel-progress');
  const finalState = control.inspect(objectiveId);

  const acceptedCountAfterCancel = finalState.protectedAttempts.filter((entry) => entry.accepted).length;
  const expectedSchedule = [
    'objective-running',
    'pre-cancel-checkpoint',
    'cancel-submitted',
    'cancel-authority-durable',
    'worker-crash',
    'recovery-attempted',
    'post-cancel-progress-challenged',
    'post-recovery-state-inspected'
  ];
  const evidence = {
    objectiveIdentity: objectiveId,
    oldWorkerIdentity,
    recoveryWorkerIdentity,
    cancelSubmission: { attempted: true, acknowledged: true },
    cancelAuthority: { durable: true, nativeState: cancel.status, epoch: cancel.cancelEpoch },
    crash: { injected: crash.crashed, targetIdentity: crash.workerId },
    recovery: { attempted: true, nativeState: recovery.status },
    postCancelProtectedOperation: {
      attempted: true,
      blockedBeforeProtectedOperation: false,
      accepted: protectedAttempt.accepted,
      acceptedCountAfterCancel
    },
    finalCancellationAuthoritative: finalState.status === 'CANCELLED' && finalState.cancelEpoch !== null,
    durableAuthorityAlive: true,
    deterministicScheduleObserved: JSON.stringify(finalState.events) === JSON.stringify(expectedSchedule),
    rawNativeEvidence: { finalState, expectedSchedule }
  };

  return { evidence, finalState };
}
