import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { t11EvidenceToRunResult } from './t11-record-bridge.mjs';

const T11_DRIVERS = Object.freeze({
  'DBOS TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'dbos-ts', 't11-driver.mjs'],
    tempPrefix: 'naia-dbos-t11-',
    blocker: 'DBOS_T11_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'DBOS_T11_DRIVER_TIMEOUT',
    invalidReason: 'DBOS_T11_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  },
  'Temporal TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'temporal-ts', 't11-driver.mjs'],
    tempPrefix: 'naia-temporal-t11-',
    blocker: 'TEMPORAL_T11_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'TEMPORAL_T11_DRIVER_TIMEOUT',
    invalidReason: 'TEMPORAL_T11_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
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

function runtimePrerequisiteFailure(processResult) {
  if (processResult?.timedOut) return false;
  return /(ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package|ECONNREFUSED|ENOENT|is required)/i.test(
    `${processResult?.stdout ?? ''}\n${processResult?.stderr ?? ''}`
  );
}

export async function runCandidateT11({ repositoryRoot, spec, setup, candidate, env, timeoutMs }) {
  const config = T11_DRIVERS[candidate.candidate];
  if (!config) throw new Error(`T11 dedicated driver not configured for ${candidate.candidate}`);

  const dir = await mkdtemp(path.join(tmpdir(), config.tempPrefix));
  const output = path.join(dir, 'evidence.json');
  const driver = path.join(repositoryRoot, ...config.relativePath);
  try {
    const processResult = await spawnAndWait(process.execPath, [driver, '--output', output], {
      cwd: path.dirname(driver),
      env: { ...env, NAIA_T11_TIMEOUT_MS: String(timeoutMs) },
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
          intended: 'T11',
          injected: false,
          targetKind: 'cancelled-worker-process',
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

    const bridged = t11EvidenceToRunResult(evidence, spec, setup);
    bridged.rawObservations.runnerProcess = processResult;
    return bridged;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
