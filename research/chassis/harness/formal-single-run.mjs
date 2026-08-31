import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCandidateExperiment } from './candidate-experiment.mjs';
import { createCommonRunnerRunHook } from './common-runner-run-hook.mjs';

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

export async function runFormalSingle({ repositoryRoot, candidateName, mutantId, repetition, outputPath, env = process.env, timeoutMs = 15000 }) {
  if (!['T7', 'T8'].includes(mutantId)) throw new Error('formal single-run current executable slice supports only T7 or T8');
  if (!Number.isInteger(repetition) || repetition < 1) throw new Error('repetition must be a positive integer');

  const runHook = createCommonRunnerRunHook({ repositoryRoot, env, timeoutMs });
  const result = await executeCandidateExperiment({
    repositoryRoot,
    candidateName,
    mutantId,
    repetition,
    runHook,
    environment: {
      packageManager: env.npm_config_user_agent ?? null,
      requiredEnvNames: Object.keys(env).filter((name) => name.startsWith('NAIA_') || name.startsWith('TEMPORAL_') || name.startsWith('DBOS_') || name.startsWith('RESTATE_') || name.startsWith('TRIGGER_')).sort()
    },
    env
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
