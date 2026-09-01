function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateObservation(observation, mutantId) {
  const errors = [];
  if (!['T7', 'T8'].includes(mutantId)) errors.push(`unsupported mutant: ${mutantId ?? 'missing'}`);
  if (!observation || typeof observation !== 'object') return ['observation must be an object'];
  if (!Number.isInteger(observation.totalApplyCount) || observation.totalApplyCount < 0) errors.push('totalApplyCount must be a non-negative integer');
  if (!Number.isInteger(observation.totalResponseLossCount) || observation.totalResponseLossCount < 0) errors.push('totalResponseLossCount must be a non-negative integer');
  if (!Number.isInteger(observation.relatedOperationCount) || observation.relatedOperationCount < 0) errors.push('relatedOperationCount must be a non-negative integer');
  if (typeof observation.durableAuthorityReachable !== 'boolean') errors.push('durableAuthorityReachable must be boolean');
  if (!nonEmpty(observation.terminalEvent)) errors.push('terminalEvent is required');
  if (!nonEmpty(observation.finalStatus)) errors.push('finalStatus is required');
  if (typeof observation.measurementCutoffReached !== 'boolean') errors.push('measurementCutoffReached must be boolean');
  return errors;
}

/**
 * Candidate-agnostic semantic evaluator for benchmark-critical T7/T8 evidence.
 *
 * Fault injection is intentionally not decided here. The experiment executor
 * classifies an absent intended fault as INCONCLUSIVE before semantic PASS/FAIL.
 * This evaluator answers only whether the observed candidate behavior satisfies
 * the frozen acceptance contract once the intended fault has been established.
 */
export function evaluateT7T8Semantics(mutantId, observation) {
  const errors = validateObservation(observation, mutantId);
  if (errors.length > 0) {
    return { mutantId, valid: false, checks: {}, passed: false, errors };
  }

  const commonChecks = {
    exactlyOneExternalApply: observation.totalApplyCount === 1,
    stableOperationIdentity: observation.relatedOperationCount === 1,
    durableAuthorityReachable: observation.durableAuthorityReachable === true,
    recoveredToCompletion: observation.terminalEvent === 'objective_completed',
    finalStatusCompleted: observation.finalStatus === 'COMPLETED'
  };

  const checks = mutantId === 'T7'
    ? {
        responseLossNotInjected: observation.totalResponseLossCount === 0,
        ...commonChecks
      }
    : {
        measurementCutoffNotReached: observation.measurementCutoffReached === false,
        ...commonChecks
      };

  return {
    mutantId,
    valid: true,
    checks,
    passed: Object.values(checks).every(Boolean),
    errors: []
  };
}
