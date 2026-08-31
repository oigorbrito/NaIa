function requireEvidence(evidence, mutantId) {
  if (!evidence || typeof evidence !== 'object') throw new Error('common runner evidence is required');
  if (!['T7', 'T8'].includes(mutantId)) throw new Error(`unsupported preregistered bridge mutant: ${mutantId}`);
  if (evidence.mutant !== mutantId) throw new Error(`common runner evidence mutant mismatch: expected ${mutantId}, got ${evidence.mutant ?? 'missing'}`);
}

function durableAuthorityReachable(evidence) {
  return evidence.status?.process?.code === 0 && Boolean(evidence.status?.parsed);
}

export function commonRunnerEvidenceToRunResult(evidence, mutantId) {
  requireEvidence(evidence, mutantId);
  const checks = evidence.checks ?? {};
  const blocked = evidence.verdict === 'BLOCKED';
  const authorityAlive = durableAuthorityReachable(evidence);

  if (mutantId === 'T7') {
    const workerFaultAddressable = evidence.mode !== 'managed-controller' && evidence.mutants?.T7_process_sigkill !== 'NOT_EXECUTED';
    return {
      blocked,
      blocker: blocked ? (evidence.blocker ?? 'RUNTIME_PREREQUISITE_BLOCKED') : null,
      fault: {
        intended: 'T7',
        injected: workerFaultAddressable && checks.crashInjected === true,
        targetKind: workerFaultAddressable ? 'worker-process' : 'worker-process-unaddressed',
        targetIdentity: evidence.initial?.pid ?? null,
        signal: evidence.initial?.signal ?? null,
        durableAuthorityAlive: authorityAlive
      },
      workload: {
        objectiveId: evidence.objectiveId,
        operationId: evidence.operationId
      },
      rawObservations: { commonRunnerEvidence: evidence },
      acceptanceChecks: {
        resumedToCompletion: checks.resumedToCompletion === true,
        expectedOperationApplied: checks.expectedOperationApplied === true,
        noIdentityDrift: checks.noIdentityDrift === true,
        noDuplicateExternalEffect: checks.noDuplicateExternalEffect === true,
        noUnexpectedResponseLoss: checks.noUnexpectedResponseLoss === true,
        durableAuthorityReachable: authorityAlive,
        finalStatusCompleted: checks.finalStatusCompleted === true
      }
    };
  }

  return {
    blocked,
    blocker: blocked ? (evidence.blocker ?? 'RUNTIME_PREREQUISITE_BLOCKED') : null,
    fault: {
      intended: 'T8',
      injected: checks.responseLossInjected === true,
      targetKind: 'external-response',
      targetIdentity: evidence.operationId ?? null,
      signal: null,
      durableAuthorityAlive: authorityAlive
    },
    workload: {
      objectiveId: evidence.objectiveId,
      operationId: evidence.operationId
    },
    rawObservations: { commonRunnerEvidence: evidence },
    acceptanceChecks: {
      resumedToCompletion: checks.resumedToCompletion === true,
      expectedOperationApplied: checks.expectedOperationApplied === true,
      noIdentityDrift: checks.noIdentityDrift === true,
      noDuplicateExternalEffect: checks.noDuplicateExternalEffect === true,
      oneResponseLossObserved: checks.oneResponseLossObserved === true,
      durableAuthorityReachable: authorityAlive,
      finalStatusCompleted: checks.finalStatusCompleted === true
    }
  };
}
