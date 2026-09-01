import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { t16EvidenceToRunResult } from './t16-record-bridge.mjs';

async function spawnAndWait(command, args, options, timeoutMs) {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}

export function runtimePrerequisiteFailure(result) {
  if (result?.timedOut) return false;
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /Cannot find package ['"][^'"]+['"]/i.test(text)
    || /Cannot find module ['"](?:@[^/'"]+\/[^'"]+|[A-Za-z0-9_.-]+(?:\/[^'"]+)?)['"]/i.test(text)
    || /\bECONNREFUSED\b/i.test(text)
    || /\bspawn\s+\S+\s+ENOENT\b/i.test(text);
}

const T16_DRIVERS = Object.freeze({
  'DBOS TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'dbos-ts', 't16-driver.mjs'],
    prefix: 'naia-dbos-t16-',
    blocker: 'DBOS_T16_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'DBOS_T16_DRIVER_TIMEOUT',
    invalidReason: 'DBOS_T16_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  },
  Restate: {
    relativePath: ['research', 'chassis', 'adapters', 'restate-ts', 't16-driver.mjs'],
    prefix: 'naia-restate-t16-',
    blocker: 'RESTATE_T16_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'RESTATE_T16_DRIVER_TIMEOUT',
    invalidReason: 'RESTATE_T16_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  }
});

export async function runCandidateT16({ repositoryRoot, spec, setup, candidate, env, timeoutMs }) {
  const config = T16_DRIVERS[candidate.candidate];
  if (!config) throw new Error(`T16 run hook has no driver for ${candidate.candidate}`);

  const dir = await mkdtemp(path.join(tmpdir(), config.prefix));
  const output = path.join(dir, 'evidence.json');
  const driver = path.join(repositoryRoot, ...config.relativePath);
  try {
    const processResult = await spawnAndWait(process.execPath, [driver, '--output', output], {
      cwd: path.dirname(driver),
      env: { ...env, NAIA_T16_TIMEOUT_MS: String(timeoutMs) },
      stdio: ['ignore', 'pipe', 'pipe']
    }, timeoutMs * 5 + 10000);

    let evidence;
    try {
      evidence = JSON.parse(await readFile(output, 'utf8'));
    } catch (error) {
      const blocked = runtimePrerequisiteFailure(processResult);
      return {
        blocked,
        blocker: blocked ? config.blocker : null,
        fault: {
          intended: 'T16',
          injected: false,
          targetKind: 'semantic-profile-recovery',
          targetIdentity: null,
          signal: null,
          durableAuthorityAlive: false
        },
        workload: { experimentId: spec.experimentId },
        rawObservations: {
          reason: processResult.timedOut ? config.timeoutReason : config.invalidReason,
          process: processResult,
          readError: String(error),
          setupIdentity: { adapterSha256: setup.adapterSha256, harnessSha256: setup.harnessSha256 }
        },
        acceptanceChecks: {}
      };
    }

    const bridged = t16EvidenceToRunResult(evidence, spec, setup);
    bridged.rawObservations.runnerProcess = processResult;
    return bridged;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
