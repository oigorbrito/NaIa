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

function runtimePrerequisiteFailure(result) {
  if (result?.timedOut) return false;
  return /(ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package|ECONNREFUSED|ENOENT|is required)/i.test(
    `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  );
}

export async function runTemporalCandidateT16({ repositoryRoot, spec, setup, env, timeoutMs }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'naia-temporal-t16-'));
  const output = path.join(dir, 'evidence.json');
  const driver = path.join(repositoryRoot, 'research', 'chassis', 'adapters', 'temporal-ts', 't16-driver.mjs');
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
        blocker: blocked ? 'TEMPORAL_T16_RUNTIME_PREREQUISITE_UNAVAILABLE' : null,
        fault: {
          intended: 'T16', injected: false, targetKind: 'semantic-profile-recovery', targetIdentity: null,
          signal: null, durableAuthorityAlive: false
        },
        workload: { experimentId: spec.experimentId },
        rawObservations: {
          reason: processResult.timedOut ? 'TEMPORAL_T16_DRIVER_TIMEOUT' : 'TEMPORAL_T16_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE',
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
