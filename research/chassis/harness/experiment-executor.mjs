import { createHash } from 'node:crypto';
import { platform, arch, release } from 'node:os';
import { deriveSeed, validateExperimentProtocol } from './experiment-protocol-validator.mjs';
import { validateExperimentRecord } from './experiment-record-validator.mjs';

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function buildExecutionPlan(protocol, faultSuite) {
  const validation = validateExperimentProtocol(protocol, faultSuite);
  if (!validation.valid) throw new Error(`invalid experiment protocol: ${validation.errors.join('; ')}`);

  const plan = [];
  const repetitions = protocol.repetitionPolicy.minimumPerCriticalMutant;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const mutantId of protocol.criticalMutants) {
      for (const candidate of protocol.candidates) {
        plan.push({
          experimentId: `${candidate.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${mutantId.toLowerCase()}-${String(repetition).padStart(3, '0')}`,
          candidate,
          mutantId,
          repetition,
          randomSeed: deriveSeed(protocol, candidate, mutantId, repetition)
        });
      }
    }
  }
  return plan;
}

function classify({ setup, run, acceptanceChecks, cleanup }) {
  if (setup.status === 'BLOCKED_SETUP') return 'BLOCKED';
  if (run.fault.injected !== true) return 'INCONCLUSIVE';
  if (cleanup.status === 'FAIL') return 'INCONCLUSIVE';
  const checks = Object.values(acceptanceChecks);
  if (checks.length === 0) return 'INCONCLUSIVE';
  return checks.every(Boolean) ? 'PASS' : 'FAIL';
}

export async function executeExperiment(spec, hooks) {
  const startedAt = new Date().toISOString();
  const runtimeEnvironment = {
    os: `${platform()} ${release()}`,
    arch: arch(),
    runtime: `node ${process.version}`,
    ...(hooks.environment ?? {})
  };

  let setupResult;
  let runResult = {
    fault: { intended: spec.mutantId, injected: false },
    workload: {}, rawObservations: {}, acceptanceChecks: {}
  };
  let cleanupResult = {
    status: 'NOT_APPLICABLE', workerCleanup: true, durableStateCleanup: true,
    oracleCleanup: true, temporaryResourcesCleanup: true
  };
  const artifacts = [];

  try {
    setupResult = await hooks.setup(spec);
    if (!setupResult || !['READY', 'BLOCKED_SETUP'].includes(setupResult.status)) {
      throw new Error('setup hook must return READY or BLOCKED_SETUP');
    }

    if (setupResult.status === 'READY') {
      runResult = await hooks.run(spec, setupResult);
      if (!runResult?.fault || typeof runResult.fault.injected !== 'boolean') {
        throw new Error('run hook must report fault injection state');
      }
    }
  } finally {
    cleanupResult = await hooks.cleanup(spec, setupResult, runResult);
  }

  for (const artifact of (hooks.artifacts ? await hooks.artifacts(spec, setupResult, runResult, cleanupResult) : [])) {
    const content = artifact.content ?? '';
    artifacts.push({ name: artifact.name, path: artifact.path ?? null, sha256: sha256(content) });
  }
  if (artifacts.length === 0) {
    artifacts.push({ name: 'experiment-observations.json', path: null, sha256: sha256(runResult.rawObservations ?? {}) });
  }

  const acceptanceChecks = runResult.acceptanceChecks ?? {};
  const verdict = classify({ setup: setupResult, run: runResult, acceptanceChecks, cleanup: cleanupResult });
  const finishedAt = new Date().toISOString();

  const record = {
    schemaVersion: 1,
    experimentId: spec.experimentId,
    candidate: spec.candidate,
    mutantId: spec.mutantId,
    repetition: spec.repetition,
    randomSeed: spec.randomSeed,
    setup: {
      status: setupResult.status,
      candidateVersion: setupResult.candidateVersion ?? 'UNKNOWN',
      candidateSourceRef: setupResult.candidateSourceRef ?? null,
      adapterSha256: setupResult.adapterSha256 ?? sha256('UNKNOWN_ADAPTER'),
      harnessSha256: setupResult.harnessSha256 ?? sha256('UNKNOWN_HARNESS'),
      dependencyIdentity: setupResult.dependencyIdentity ?? null,
      environment: runtimeEnvironment,
      parameters: { randomSeed: spec.randomSeed, ...(setupResult.parameters ?? {}) },
      cleanupVerifiedBeforeRun: setupResult.cleanupVerifiedBeforeRun === true
    },
    run: {
      startedAt,
      finishedAt,
      workload: runResult.workload ?? {},
      fault: runResult.fault,
      rawObservations: runResult.rawObservations ?? {},
      acceptanceChecks
    },
    cleanup: cleanupResult,
    artifacts,
    verdict,
    blocker: setupResult.status === 'BLOCKED_SETUP' ? (setupResult.blocker ?? 'SETUP_BLOCKED') : null
  };

  const validation = validateExperimentRecord(record);
  if (!validation.valid) {
    return { record, valid: false, validationErrors: validation.errors };
  }
  return { record, valid: true, validationErrors: [] };
}
