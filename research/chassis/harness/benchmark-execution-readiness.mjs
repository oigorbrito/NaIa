import {
  FORMAL_CLEANUP_SUPPORT,
  formalCleanupSupportsCandidate,
  missingFormalCleanupPhases
} from './formal-cleanup-support.mjs';
import { FORMAL_EXECUTOR_SUPPORT, formalExecutorSupportsCandidate } from './formal-executor-support.mjs';

export function assessBenchmarkExecutionReadiness(
  protocol,
  criticalPlan,
  support = FORMAL_EXECUTOR_SUPPORT,
  cleanupSupport = FORMAL_CLEANUP_SUPPORT
) {
  const errors = [];
  const criticalMutants = protocol?.criticalMutants ?? [];
  const plannedCritical = criticalPlan?.criticalMutants ?? [];

  if (JSON.stringify([...criticalMutants].sort()) !== JSON.stringify([...plannedCritical].sort())) {
    errors.push('critical mutant set differs between protocol and critical-mutant plan');
  }

  const unsupportedMutants = criticalMutants.filter((mutantId) => !support?.[mutantId]);
  const unsupportedCandidateMutants = [];
  const unsupportedCleanupCandidates = [];

  for (const candidate of criticalPlan?.candidates ?? []) {
    const cleanupEntry = cleanupSupport?.[candidate.candidate] ?? {};
    const missingCleanupPhases = missingFormalCleanupPhases(cleanupSupport, candidate.candidate);
    if (!formalCleanupSupportsCandidate(cleanupSupport, candidate.candidate)) {
      unsupportedCleanupCandidates.push({
        candidate: candidate.candidate,
        mode: candidate.mode,
        missingPhases: missingCleanupPhases,
        status: cleanupEntry.status ?? null,
        evidenceBacked: Boolean(cleanupEntry.verificationEvidence)
      });
    }

    for (const mutantId of criticalMutants) {
      const implementation = support?.[mutantId];
      if (!implementation) continue;
      if (!formalExecutorSupportsCandidate(support, mutantId, candidate)) {
        unsupportedCandidateMutants.push({
          candidate: candidate.candidate,
          mutantId,
          mode: candidate.mode,
          supportedModes: [...(implementation.modes ?? [])],
          supportedCandidates: Array.isArray(implementation.candidates) ? [...implementation.candidates] : null
        });
      }
    }
  }

  const ready = errors.length === 0
    && unsupportedMutants.length === 0
    && unsupportedCandidateMutants.length === 0
    && unsupportedCleanupCandidates.length === 0;
  return {
    ready,
    status: ready ? 'BENCHMARK_EXECUTION_READY' : 'BENCHMARK_EXECUTION_NOT_READY',
    criticalMutants: [...criticalMutants],
    unsupportedMutants,
    unsupportedCandidateMutants,
    unsupportedCleanupCandidates,
    errors
  };
}

export function assertBenchmarkExecutionReady(
  protocol,
  criticalPlan,
  support = FORMAL_EXECUTOR_SUPPORT,
  cleanupSupport = FORMAL_CLEANUP_SUPPORT
) {
  const assessment = assessBenchmarkExecutionReadiness(protocol, criticalPlan, support, cleanupSupport);
  if (!assessment.ready) {
    const reasons = [
      ...assessment.errors,
      ...assessment.unsupportedMutants.map((mutantId) => `${mutantId}: formal executor not implemented`),
      ...assessment.unsupportedCandidateMutants.map((entry) => `${entry.candidate}/${entry.mutantId}: formal executor not implemented for candidate/mode`),
      ...assessment.unsupportedCleanupCandidates.map((entry) => {
        const phaseReason = entry.missingPhases.length > 0 ? `missing ${entry.missingPhases.join(',')}` : 'cleanup phases declared';
        return `${entry.candidate}: formal cleanup not runtime-verified with evidence (${phaseReason}; status=${entry.status ?? 'missing'}; evidenceBacked=${entry.evidenceBacked})`;
      })
    ];
    throw new Error(`benchmark execution gate closed: ${reasons.join('; ')}`);
  }
  return assessment;
}
