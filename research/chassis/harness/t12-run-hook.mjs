import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { t12EvidenceToRunResult } from './t12-record-bridge.mjs';

const T12_DRIVERS = Object.freeze({
  'DBOS TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'dbos-ts', 't12-driver.mjs'],
    tempPrefix: 'naia-dbos-t12-',
    blocker: 'DBOS_T12_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'DBOS_T12_DRIVER_TIMEOUT',
    invalidReason: 'DBOS_T12_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  },
  'Temporal TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'temporal-ts', 't12-driver.mjs'],
    tempPrefix: 'naia-temporal-t12-',
    blocker: 'TEMPORAL_T12_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'TEMPORAL_T12_DRIVER_TIMEOUT',
    invalidReason: 'TEMPORAL_T12_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  }
});

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

export async function runCandidateT12({ repositoryRoot, spec, setup, candidate, env, timeoutMs }) {
  const config = T12_DRIVERS[candidate.candidate];
  if (!config) throw new Error(`T12 run hook has no driver for ${candidate.candidate}`);

  const dir = await mkdtemp(path.join(tmpdir(), config.tempPrefix));
  const output = path.join(dir, 'evidence.json');
  const driver = path.join(repositoryRoot, ...config.relativePath);
  try {
    const processResult = await spawnAndWait(process.execPath, [driver, '--output', output], {
      cwd: path.dirname(driver),
      env: { ...env, NAIA_T12_TIMEOUT_MS: String(timeoutMs) },
      stdio: ['ignore', 'pipe', 'pipe']
    }, timeoutMs * 4 + 10000);

    let evidence;
    try {
      evidence = JSON.parse(await readFile(output, 'utf8'));
    } catch (error) {
      const blocked = runtimePrerequisiteFailure(processResult);
      return {
        blocked,
        blocker: blocked ? config.blocker : null,
        fault: {
          intended: 'T12',
          injected: false,
          targetKind: 'stale-completion-authority',
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

    const bridged = t12EvidenceToRunResult(evidence, spec, setup);
    bridged.rawObservations.runnerProcess = processResult;
    return bridged;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
