import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCandidateExperiment, loadExperimentContext } from './candidate-experiment.mjs';
import { candidateByName } from './candidate-setup.mjs';
import { createCommonRunnerRunHook } from './common-runner-run-hook.mjs';
import { FORMAL_EXECUTOR_SUPPORT, formalExecutorSupportsCandidate } from './formal-executor-support.mjs';
import { lifecycleQualificationRecordProvenance } from './formal-lifecycle-qualification-provenance.mjs';
import { formalPromotionPolicyProvenance } from './formal-promotion-policy.mjs';
import { createFormalRuntimeLifecycle } from './formal-runtime-lifecycle-router.mjs';
import { inspectRepositoryProvenance } from './repository-provenance.mjs';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function requireValue(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function resolveRepositoryProvenance(repositoryRoot, inspector) {
  try {
    return await inspector(repositoryRoot);
  } catch (error) {
    return {
      source: 'git',
      status: 'UNVERIFIED',
      revision: null,
      trackedWorktreeClean: null,
      reason: 'REPOSITORY_PROVENANCE_INSPECTOR_ERROR',
      diagnostics: { error: String(error) }
    };
  }
}

export async function runFormalSingle({
  repositoryRoot,
  candidateName,
  mutantId,
  repetition,
  outputPath,
  env = process.env,
  timeoutMs = 15000,
  lifecycleFactory = createFormalRuntimeLifecycle,
  runHookFactory = createCommonRunnerRunHook,
  repositoryProvenanceInspector = inspectRepositoryProvenance
}) {
  if (!Number.isInteger(repetition) || repetition < 1) throw new Error('repetition must be a positive integer');

  const context = await loadExperimentContext(repositoryRoot);
  const candidate = candidateByName(context.capabilities, candidateName);
  if (!formalExecutorSupportsCandidate(FORMAL_EXECUTOR_SUPPORT, mutantId, candidate)) {
    throw new Error(`FORMAL_EXECUTOR_NOT_DECLARED_FOR_CANDIDATE:${candidateName}/${mutantId}`);
  }

  const repositoryProvenance = await resolveRepositoryProvenance(repositoryRoot, repositoryProvenanceInspector);
  const runtimeEnv = { ...env };
  const lifecycle = lifecycleFactory({
    candidateName,
    repositoryRoot,
    env: runtimeEnv,
    timeoutMs
  });
  const runHook = runHookFactory({ repositoryRoot, env: runtimeEnv, timeoutMs });
  const declaredEnvNames = [...new Set([
    ...Object.keys(runtimeEnv).filter((name) => name.startsWith('NAIA_') || name.startsWith('TEMPORAL_') || name.startsWith('DBOS_') || name.startsWith('RESTATE_') || name.startsWith('TRIGGER_')),
    ...(lifecycle?.declaredEnvNames ?? [])
  ])].sort();
  const lifecycleQualification = lifecycleQualificationRecordProvenance(repositoryRoot, candidateName);

  const result = await executeCandidateExperiment({
    repositoryRoot,
    candidateName,
    mutantId,
    repetition,
    runHook,
    preRunCleanupHook: lifecycle?.preRunCleanupHook,
    cleanupHook: lifecycle?.cleanupHook,
    repositoryProvenance,
    environment: {
      packageManager: runtimeEnv.npm_config_user_agent ?? null,
      requiredEnvNames: declaredEnvNames,
      repositoryProvenance,
      formalPromotionPolicy: formalPromotionPolicyProvenance(),
      formalLifecycleQualification: lifecycleQualification,
      formalRuntimeLifecycle: lifecycle
        ? { candidate: lifecycle.candidateName, status: lifecycle.status }
        : null
    },
    env: runtimeEnv
  });

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result.record, null, 2)}\n`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(args.get('--repository-root') ?? path.join(here, '..', '..', '..'));
  const candidateName = requireValue(args, '--candidate');
  const mutantId = requireValue(args, '--mutant');
  const repetition = Number(requireValue(args, '--repetition'));
  const outputPath = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const timeoutMs = Number(args.get('--timeout-ms') ?? '15000');

  const result = await runFormalSingle({ repositoryRoot, candidateName, mutantId, repetition, outputPath, timeoutMs });
  const ledgerDisposition = {
    appended: false,
    executorDeclaredForCandidate: true,
    eligibility: 'NOT_EVALUATED_WITHOUT_LEDGER_PREFIX',
    authority: 'experiment-ledger-validator.mjs',
    note: 'A schema-valid single-run record is qualification evidence until the ledger guard proves it is the next exact preregistered round-robin experiment.'
  };
  process.stdout.write(`${JSON.stringify({ valid: result.valid, validationErrors: result.validationErrors, ledgerDisposition, record: result.record }, null, 2)}\n`);

  if (!result.valid) process.exitCode = 3;
  else if (result.record.verdict === 'PASS') process.exitCode = 0;
  else if (result.record.verdict === 'FAIL') process.exitCode = 1;
  else process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 3;
  });
}
