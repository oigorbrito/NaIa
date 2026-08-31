import path from 'node:path';
import { runIsolatedExternalFault } from './isolated-external-fault-runner.mjs';

export function createCriticalRunHook({ repositoryRoot, env = process.env, timeoutMs = 15000 }) {
  return async function runHook(spec, setup, candidate) {
    if (!['T7', 'T8'].includes(spec.mutantId)) {
      return {
        fault: { intended: spec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: null },
        workload: {},
        rawObservations: { reason: 'CRITICAL_RUN_HOOK_NOT_IMPLEMENTED_FOR_MUTANT' },
        acceptanceChecks: {}
      };
    }

    if (candidate.candidate === 'Trigger.dev' && spec.mutantId === 'T7') {
      return {
        fault: {
          intended: 'SIGKILL actual Trigger.dev TaskRunProcess worker after external effect before checkpoint',
          injected: false,
          targetKind: 'worker-process',
          targetIdentity: null,
          signal: 'SIGKILL',
          durableAuthorityAlive: null
        },
        workload: {},
        rawObservations: { reason: 'B003_MANAGED_CONTROLLER_WORKER_SIGKILL_HOOK_NOT_CONNECTED' },
        acceptanceChecks: {}
      };
    }

    const adapter = path.join(repositoryRoot, candidate.adapter);
    const cwd = path.dirname(adapter);
    return runIsolatedExternalFault({
      adapter,
      candidate: candidate.candidate,
      cwd,
      mutantId: spec.mutantId,
      timeoutMs,
      env
    });
  };
}
