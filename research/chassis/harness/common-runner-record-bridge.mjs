import { normalizeWorkerProcessPids } from './formal-worker-pid-provenance.mjs';
import { evaluateT7T8Semantics } from './t7-t8-evaluator.mjs';

function requireEvidence(evidence, mutantId) {
  if (!evidence || typeof evidence !== 'object') throw new Error('common runner evidence is required');
  if (!['T7', 'T8'].includes(mutantId)) throw new Error(`unsupported preregistered bridge mutant: ${mutantId}`);
  if (evidence.mutant !== mutantId) throw new Error(`common runner evidence mutant mismatch: expected ${mutantId}, got ${evidence.mutant ?? 'missing'}`);
}

function durableAuthorityReachable(evidence) {
  return evidence.status?.process?.code === 0 && Boolean(evidence.status?.parsed);
}

function semanticObservation(evidence, mutantId, authorityAlive) {
  const terminal = mutantId === 'T7'
    ? evidence.resume?.terminalEvent
    : evidence.initial?.terminalEvent;
  return {
    totalApplyCount: evidence.oracle?.totalApplyCount ?? -1,
    totalResponseLossCount: evidence.oracle?.totalResponseLossCount ?? -1,
    relatedOperationCount: Array.isArray(evidence.oracle?.operations) ? evidence.oracle.operations.length : -1,
    durableAuthorityReachable: authorityAlive,
    terminalEvent: terminal?.event ?? 'missing_terminal_event',
    finalStatus: evidence.status?.parsed?.state ?? 'MISSING_FINAL_STATUS',
    measurementCutoffReached: evidence.initial?.timedOut === true
  };
}

export function commonRunnerEvidenceToRunResult(evidence, mutantId) {
  requireEvidence(evidence, mutantId);
  const blocked = evidence.verdict === 'BLOCKED';
  const authorityAlive = durableAuthorityReachable(evidence);
  const workerProcessPids = normalizeWorkerProcessPids(evidence.initial?.pid, evidence.resume?.pid);
  const semanticEvaluation = evaluateT7T8Semantics(mutantId, semanticObservation(evidence, mutantId, authorityAlive));

  if (mutantId === 'T7') {
    const workerFaultAddressable = evidence.mode !== 'managed-controller' && evidence.mutants?.T7_process_sigkill !== 'NOT_EXECUTED';
    const killReceiptValid = evidence.initial?.killIssued === true && evidence.initial?.timedOut !== true;
    return {
      blocked,
      blocker: blocked ? (evidence.blocker ?? 'RUNTIME_PREREQUISITE_BLOCKED') : null,
      fault: {
        intended: 'T7',
        injected: workerFaultAddressable && killReceiptValid,
        targetKind: workerFaultAddressable ? 'worker-process' : 'worker-process-unaddressed',
        targetIdentity: evidence.initial?.pid ?? null,
        signal: evidence.initial?.signal ?? null,
        durableAuthorityAlive: authorityAlive
      },
      workload: {
        objectiveId: evidence.objectiveId,
        operationId: evidence.operationId
      },
      rawObservations: {
        workerProcessPids,
        commonRunnerEvidence: evidence,
        semanticEvaluationValid: semanticEvaluation.valid,
        semanticEvaluationErrors: semanticEvaluation.errors
      },
      acceptanceChecks: semanticEvaluation.checks
    };
  }

  const responseLossReceiptValid = evidence.oracle?.totalResponseLossCount === 1;
  return {
    blocked,
    blocker: blocked ? (evidence.blocker ?? 'RUNTIME_PREREQUISITE_BLOCKED') : null,
    fault: {
      intended: 'T8',
      injected: responseLossReceiptValid,
      targetKind: 'external-response',
      targetIdentity: evidence.operationId ?? null,
      signal: null,
      durableAuthorityAlive: authorityAlive
    },
    workload: {
      objectiveId: evidence.objectiveId,
      operationId: evidence.operationId
    },
    rawObservations: {
      workerProcessPids,
      commonRunnerEvidence: evidence,
      semanticEvaluationValid: semanticEvaluation.valid,
      semanticEvaluationErrors: semanticEvaluation.errors
    },
    acceptanceChecks: semanticEvaluation.checks
  };
}
