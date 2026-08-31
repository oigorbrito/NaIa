import { FORMAL_EXECUTOR_SUPPORT } from './formal-executor-support.mjs';

export function assessBenchmarkExecutionReadiness(protocol, criticalPlan, support = FORMAL_EXECUTOR_SUPPORT) {
  const errors = [];
  const criticalMutants = protocol?.criticalMutants ?? [];
  const plannedCritical = criticalPlan?.criticalMutants ?? [];

  if (JSON.stringify([...criticalMutants].sort()) !== JSON.stringify([...plannedCritical].sort())) {
    errors.push('critical mutant set differs between protocol and critical-mutant plan');
  }

  const unsupportedMutants = criticalMutants.filter((mutantId) => !support?.[mutantId]);
  const incompatibleCandidateModes = [];

  for (const candidate of criticalPlan?.candidates ?? []) {
    for (const mutantId of criticalMutants) {
      const implementation = support?.[mutantId];
      if (!implementation) continue;
      if (!implementation.modes?.includes(candidate.mode)) {
        incompatibleCandidateModes.push({
          candidate: candidate.candidate,
          mutantId,
          mode: candidate.mode,
          supportedModes: [...(implementation.modes ?? [])]
        });
      }
    }
  }

  const ready = errors.length === 0 && unsupportedMutants.length === 0 && incompatibleCandidateModes.length === 0;
  return {
    ready,
    status: ready ? 'BENCHMARK_EXECUTION_READY' : 'BENCHMARK_EXECUTION_NOT_READY',
    criticalMutants: [...criticalMutants],
    unsupportedMutants,
    incompatibleCandidateModes,
    errors
  };
}

export function assertBenchmarkExecutionReady(protocol, criticalPlan, support = FORMAL_EXECUTOR_SUPPORT) {
  const assessment = assessBenchmarkExecutionReadiness(protocol, criticalPlan, support);
  if (!assessment.ready) {
    const reasons = [
      ...assessment.errors,
      ...assessment.unsupportedMutants.map((mutantId) => `${mutantId}: formal executor not implemented`),
      ...assessment.incompatibleCandidateModes.map((entry) => `${entry.candidate}/${entry.mutantId}: mode ${entry.mode} unsupported by formal executor`)
    ];
    throw new Error(`benchmark execution gate closed: ${reasons.join('; ')}`);
  }
  return assessment;
}
