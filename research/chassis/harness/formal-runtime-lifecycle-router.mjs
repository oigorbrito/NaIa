import { createDbosFormalLifecycle } from './formal-dbos-lifecycle.mjs';
import { createFormalRuntimeLifecycle as createTemporalFormalRuntimeLifecycle } from './formal-runtime-lifecycle.mjs';

export function createFormalRuntimeLifecycle({
  candidateName,
  repositoryRoot,
  env = process.env,
  timeoutMs = 15000,
  operations = null
} = {}) {
  if (candidateName === 'DBOS TypeScript') {
    return createDbosFormalLifecycle({ repositoryRoot, env, timeoutMs, operations });
  }
  return createTemporalFormalRuntimeLifecycle({ candidateName, repositoryRoot, env, timeoutMs, operations });
}
