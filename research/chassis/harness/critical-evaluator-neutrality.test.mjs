import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateT5Evidence } from './t5-evaluator.mjs';
import { evaluateT7T8Semantics } from './t7-t8-evaluator.mjs';
import { evaluateT11Evidence } from './t11-evaluator.mjs';
import { evaluateT12Evidence } from './t12-evaluator.mjs';
import { evaluateT16Evidence } from './t16-evaluator.mjs';

function withCandidate(value, candidate) {
  return { ...value, candidate };
}

function assertCandidateNeutral(evaluator, evidence) {
  const temporal = evaluator(withCandidate(evidence, 'Temporal TypeScript'));
  const dbos = evaluator(withCandidate(evidence, 'DBOS TypeScript'));
  const restate = evaluator(withCandidate(evidence, 'Restate'));
  const trigger = evaluator(withCandidate(evidence, 'Trigger.dev'));
  assert.deepEqual(dbos, temporal);
  assert.deepEqual(restate, temporal);
  assert.deepEqual(trigger, temporal);
}

const t5Evidence = {
  oldWorkerIdentity: 'worker-a',
  newWorkerIdentity: 'worker-b',
  oldAuthorityIdentity: 'owner-a:1',
  newAuthorityIdentity: 'owner-b:2',
  authorityAdvanced: true,
  oldAuthorityHeldUntilTakeover: true,
  staleCompletion: {
    attempted: true,
    attemptedBeforeNewCompletion: true,
    rejectedOrNonAuthoritative: true,
    becameAuthoritative: false
  },
  newAuthorityStillCurrentAfterStaleAttempt: true,
  newAuthorityCompletion: { attempted: true, acceptedOrAuthoritative: true },
  finalAuthorityIdentity: 'owner-b:2',
  finalResultOrigin: 'new-authority',
  durableAuthorityAlive: true,
  deterministicScheduleObserved: true
};

const t11Evidence = {
  objectiveIdentity: 'objective-1',
  oldWorkerIdentity: 'worker-a',
  recoveryWorkerIdentity: 'worker-b',
  cancelSubmission: { attempted: true, acknowledged: true },
  cancelAuthority: { durable: true },
  crash: { injected: true, targetIdentity: 'worker-a' },
  recovery: { attempted: true },
  postCancelProtectedOperation: {
    attempted: true,
    accepted: false,
    acceptedCountAfterCancel: 0
  },
  finalCancellationAuthoritative: true,
  durableAuthorityAlive: true,
  deterministicScheduleObserved: true
};

const t12Evidence = {
  oldAuthorityIdentity: 'owner-a:1',
  newAuthorityIdentity: 'owner-b:2',
  authorityAdvanced: true,
  oldCompletionHeldUntilNewCommit: true,
  newAuthorityCompletion: { attempted: true, acceptedOrAuthoritative: true },
  staleCompletion: {
    attempted: true,
    attemptedAfterNewCommit: true,
    rejectedOrNonAuthoritative: true,
    becameAuthoritative: false
  },
  finalAuthorityIdentity: 'owner-b:2',
  finalResultOrigin: 'new-authority',
  durableAuthorityAlive: true,
  deterministicScheduleObserved: true
};

const t16Evidence = {
  objectiveIdentity: 'objective-1',
  semanticMutation: { dimension: 'config', before: 'a', after: 'b' },
  durableCheckpointBeforeMutation: true,
  recoveryAttemptedUnderMutatedProfile: true,
  compatibilityDisposition: { kind: 'REJECTED_INCOMPATIBLE', explicit: true },
  silentSemanticChangeObserved: false,
  priorMeaningPreservedOrExplicitlyMigrated: true,
  durableAuthorityAlive: true,
  deterministicScheduleObserved: true
};

const t7Observation = {
  totalApplyCount: 1,
  totalResponseLossCount: 0,
  relatedOperationCount: 1,
  durableAuthorityReachable: true,
  terminalEvent: 'objective_completed',
  finalStatus: 'COMPLETED',
  measurementCutoffReached: false
};

const t8Observation = { ...t7Observation, totalResponseLossCount: 1 };

test('all benchmark-critical evaluator authorities are candidate-agnostic', () => {
  assertCandidateNeutral(evaluateT5Evidence, t5Evidence);
  assertCandidateNeutral((value) => evaluateT7T8Semantics('T7', value), t7Observation);
  assertCandidateNeutral((value) => evaluateT7T8Semantics('T8', value), t8Observation);
  assertCandidateNeutral(evaluateT11Evidence, t11Evidence);
  assertCandidateNeutral(evaluateT12Evidence, t12Evidence);
  assertCandidateNeutral(evaluateT16Evidence, t16Evidence);
});
