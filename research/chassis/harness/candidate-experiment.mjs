import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { candidateByName, inspectCandidateSetup } from './candidate-setup.mjs';
import { buildExecutionPlan, executeExperiment } from './experiment-executor.mjs';

const CLEANUP_DIMENSIONS = Object.freeze([
  'workerCleanup',
  'durableStateCleanup',
  'oracleCleanup',
  'temporaryResourcesCleanup'
]);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadExperimentContext(repositoryRoot) {
  const chassisRoot = path.join(repositoryRoot, 'research', 'chassis');
  const [protocol, faultSuite, capabilities] = await Promise.all([
    readJson(path.join(chassisRoot, 'experiment-protocol.v1.json')),
    readJson(path.join(chassisRoot, 'fault-suite.v1.json')),
    readJson(path.join(chassisRoot, 'adapter-capabilities.v1.json'))
  ]);
  const plan = buildExecutionPlan(protocol, faultSuite);
  return { protocol, faultSuite, capabilities, plan };
}

export function selectExperiment(plan, { candidate, mutantId, repetition }) {
  const spec = plan.find((entry) => entry.candidate === candidate && entry.mutantId === mutantId && entry.repetition === repetition);
  if (!spec) throw new Error(`experiment not found in preregistered plan: ${candidate}/${mutantId}/${repetition}`);
  return spec;
}

export function preRunCleanupReceiptValid(receipt) {
  return receipt?.status === 'PASS' && CLEANUP_DIMENSIONS.every((key) => receipt[key] === true);
}

export function applyPreRunCleanupGate(setup, receipt) {
  if (!setup || setup.status !== 'READY') return setup;
  const verified = preRunCleanupReceiptValid(receipt);
  if (verified) {
    return {
      ...setup,
      cleanupVerifiedBeforeRun: true,
      diagnostics: { ...(setup.diagnostics ?? {}), preRunCleanupReceipt: receipt }
    };
  }
  return {
    ...setup,
    status: 'BLOCKED_SETUP',
    blocker: 'PRE_RUN_CLEANUP_NOT_VERIFIED',
    cleanupVerifiedBeforeRun: false,
    diagnostics: { ...(setup.diagnostics ?? {}), preRunCleanupReceipt: receipt ?? null }
  };
}

export function defaultCleanupResult(setup) {
  if (setup?.status === 'BLOCKED_SETUP') {
    return {
      status: 'NOT_APPLICABLE',
      workerCleanup: true,
      durableStateCleanup: true,
      oracleCleanup: true,
      temporaryResourcesCleanup: true
    };
  }
  return {
    status: 'FAIL',
    workerCleanup: false,
    durableStateCleanup: false,
    oracleCleanup: false,
    temporaryResourcesCleanup: false,
    reason: 'CLEANUP_HOOK_NOT_CONFIGURED'
  };
}

function failedPreRunReceipt(error) {
  return {
    status: 'FAIL',
    workerCleanup: false,
    durableStateCleanup: false,
    oracleCleanup: false,
    temporaryResourcesCleanup: false,
    reason: 'PRE_RUN_CLEANUP_HOOK_ERROR',
    error: String(error)
  };
}

export async function executeCandidateExperiment({
  repositoryRoot,
  candidateName,
  mutantId,
  repetition,
  runHook,
  preRunCleanupHook,
  cleanupHook,
  artifactHook,
  environment,
  repositoryProvenance = null,
  env = process.env
}) {
  const context = await loadExperimentContext(repositoryRoot);
  const candidate = candidateByName(context.capabilities, candidateName);
  const spec = selectExperiment(context.plan, { candidate: candidateName, mutantId, repetition });
  const harnessPath = path.join(repositoryRoot, 'research', 'chassis', 'harness', 'experiment-executor.mjs');

  return executeExperiment(spec, {
    environment,
    setup: async () => {
      // Candidate-owned lifecycle infrastructure may be necessary to establish
      // required environment coordinates (for example DBOS_SYSTEM_DATABASE_URL).
      // Establish it first, then inspect the fully concrete setup. A failed
      // lifecycle never becomes candidate FAIL: the cleanup receipt gate closes
      // setup before the run hook can execute.
      let receipt = null;
      if (typeof preRunCleanupHook === 'function') {
        try {
          receipt = await preRunCleanupHook(spec, null, candidate, context);
        } catch (error) {
          receipt = failedPreRunReceipt(error);
        }
      }

      const inspected = await inspectCandidateSetup({
        candidate,
        repositoryRoot,
        harnessPath,
        env,
        formalProvenance: true,
        repositoryProvenance
      });
      if (inspected.status !== 'READY') {
        return {
          ...inspected,
          diagnostics: { ...(inspected.diagnostics ?? {}), preRunCleanupReceipt: receipt }
        };
      }
      return applyPreRunCleanupGate(inspected, receipt);
    },
    run: async (selectedSpec, setup) => {
      if (typeof runHook !== 'function') {
        return {
          fault: { intended: selectedSpec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: null },
          workload: {},
          rawObservations: { reason: 'RUNTIME_RUN_HOOK_NOT_CONFIGURED' },
          acceptanceChecks: {}
        };
      }
      return runHook(selectedSpec, setup, candidate, context);
    },
    cleanup: async (selectedSpec, setup, run) => {
      if (typeof cleanupHook === 'function') return cleanupHook(selectedSpec, setup, run, candidate, context);
      return defaultCleanupResult(setup);
    },
    artifacts: typeof artifactHook === 'function'
      ? (selectedSpec, setup, run, cleanup) => artifactHook(selectedSpec, setup, run, cleanup, candidate, context)
      : undefined
  });
}
