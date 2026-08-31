import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commonRunnerEvidenceToRunResult } from './common-runner-record-bridge.mjs';
import { FORMAL_EXECUTOR_SUPPORT, formalExecutorSupportsCandidate } from './formal-executor-support.mjs';

async function spawnAndWait(command, args, options, timeoutMs = null) {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs)
    : null;
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (timer) clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}

export function createCommonRunnerRunHook({ repositoryRoot, env = process.env, timeoutMs = 15000 } = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const runner = path.join(repositoryRoot, 'research', 'chassis', 'harness', 'common-runner.mjs');

  return async function runHook(spec, setup, candidate) {
    const support = FORMAL_EXECUTOR_SUPPORT[spec.mutantId];
    if (!support) {
      return {
        blocked: false,
        blocker: null,
        fault: { intended: spec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: null },
        workload: {},
        rawObservations: { reason: 'FORMAL_EXECUTOR_NOT_IMPLEMENTED_FOR_MUTANT' },
        acceptanceChecks: {}
      };
    }
    if (!formalExecutorSupportsCandidate(FORMAL_EXECUTOR_SUPPORT, spec.mutantId, candidate)) {
      return {
        blocked: false,
        blocker: null,
        fault: { intended: spec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: null },
        workload: {},
        rawObservations: {
          reason: 'FORMAL_EXECUTOR_NOT_IMPLEMENTED_FOR_CANDIDATE',
          supportedModes: support.modes,
          supportedCandidates: support.candidates,
          candidateMode: candidate.mode,
          candidate: candidate.candidate
        },
        acceptanceChecks: {}
      };
    }

    const managedOracleUrl = candidate.mode === 'managed-controller' ? env.NAIA_EXTERNAL_ORACLE_URL : null;
    if (candidate.mode === 'managed-controller' && !managedOracleUrl) {
      return {
        blocked: true,
        blocker: 'NAIA_EXTERNAL_ORACLE_URL_REQUIRED',
        fault: { intended: spec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: false },
        workload: {},
        rawObservations: { reason: 'MANAGED_WORKER_ORACLE_URL_MISSING' },
        acceptanceChecks: {}
      };
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'naia-common-run-'));
    const output = path.join(dir, 'evidence.json');
    const adapter = path.join(repositoryRoot, candidate.adapter);
    const args = [
      runner,
      '--adapter', adapter,
      '--candidate', spec.candidate,
      '--mode', candidate.mode,
      '--mutant', spec.mutantId,
      '--timeout-ms', String(timeoutMs),
      '--output', output
    ];
    if (managedOracleUrl) args.push('--oracle-url', managedOracleUrl);

    try {
      const processResult = await spawnAndWait(process.execPath, args, {
        cwd: path.dirname(adapter),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }, timeoutMs + 5000);
      let evidence;
      try {
        evidence = JSON.parse(await readFile(output, 'utf8'));
      } catch (error) {
        return {
          blocked: false,
          blocker: null,
          fault: { intended: spec.mutantId, injected: false, targetKind: null, targetIdentity: null, signal: null, durableAuthorityAlive: null },
          workload: {},
          rawObservations: {
            reason: processResult.timedOut ? 'COMMON_RUNNER_PROCESS_TIMEOUT' : 'COMMON_RUNNER_DID_NOT_EMIT_VALID_EVIDENCE',
            process: processResult,
            readError: String(error)
          },
          acceptanceChecks: {}
        };
      }

      const bridged = commonRunnerEvidenceToRunResult(evidence, spec.mutantId);
      bridged.rawObservations.runnerProcess = processResult;
      bridged.rawObservations.setupIdentity = {
        adapterSha256: setup.adapterSha256,
        harnessSha256: setup.harnessSha256
      };
      return bridged;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
