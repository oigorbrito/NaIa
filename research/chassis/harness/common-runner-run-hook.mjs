import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commonRunnerEvidenceToRunResult } from './common-runner-record-bridge.mjs';
import { t5EvidenceToRunResult } from './t5-record-bridge.mjs';
import { runCandidateT11 } from './t11-run-hook.mjs';
import { runCandidateT12 } from './t12-run-hook.mjs';
import { runCandidateT16 } from './t16-run-hook.mjs';
import { runTemporalCandidateT16 } from './t16-temporal-run-hook.mjs';
import { runTriggerdevManagedT7 } from './triggerdev-managed-t7-run-hook.mjs';
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

export function runtimePrerequisiteFailure(processResult) {
  if (processResult?.timedOut) return false;
  const text = `${processResult?.stdout ?? ''}\n${processResult?.stderr ?? ''}`;
  return /Cannot find package ['"][^'"]+['"]/i.test(text)
    || /Cannot find module ['"](?:@[^/'"]+\/[^'"]+|[A-Za-z0-9_.-]+(?:\/[^'"]+)?)['"]/i.test(text)
    || /\bECONNREFUSED\b/i.test(text)
    || /\bspawn\s+\S+\s+ENOENT\b/i.test(text);
}

const T5_DRIVERS = Object.freeze({
  'Temporal TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'temporal-ts', 't5-two-worker-driver.mjs'],
    tempPrefix: 'naia-temporal-t5-',
    blocker: 'TEMPORAL_T5_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'TEMPORAL_T5_DRIVER_TIMEOUT',
    invalidReason: 'TEMPORAL_T5_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  },
  'DBOS TypeScript': {
    relativePath: ['research', 'chassis', 'adapters', 'dbos-ts', 't5-two-worker-driver.mjs'],
    tempPrefix: 'naia-dbos-t5-',
    blocker: 'DBOS_T5_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'DBOS_T5_DRIVER_TIMEOUT',
    invalidReason: 'DBOS_T5_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  },
  Restate: {
    relativePath: ['research', 'chassis', 'adapters', 'restate-ts', 't5-two-worker-driver.mjs'],
    tempPrefix: 'naia-restate-t5-',
    blocker: 'RESTATE_T5_RUNTIME_PREREQUISITE_UNAVAILABLE',
    timeoutReason: 'RESTATE_T5_DRIVER_TIMEOUT',
    invalidReason: 'RESTATE_T5_DRIVER_DID_NOT_EMIT_VALID_EVIDENCE'
  }
});

async function runCandidateT5({ repositoryRoot, spec, setup, candidate, env, timeoutMs }) {
  const config = T5_DRIVERS[candidate.candidate];
  if (!config) throw new Error(`T5 driver config missing for ${candidate.candidate}`);
  const dir = await mkdtemp(path.join(tmpdir(), config.tempPrefix));
  const output = path.join(dir, 'evidence.json');
  const driver = path.join(repositoryRoot, ...config.relativePath);
  try {
    const processResult = await spawnAndWait(process.execPath, [driver, '--output', output], {
      cwd: path.dirname(driver),
      env: { ...env, NAIA_T5_TIMEOUT_MS: String(timeoutMs) },
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
          intended: 'T5', injected: false, targetKind: 'concurrent-worker-ownership-race', targetIdentity: null,
          signal: null, durableAuthorityAlive: false
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

    const bridged = t5EvidenceToRunResult(evidence, spec, setup);
    bridged.rawObservations.runnerProcess = processResult;
    return bridged;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

    if (spec.mutantId === 'T7' && candidate.candidate === 'Trigger.dev' && candidate.mode === 'managed-controller') {
      return runTriggerdevManagedT7({ repositoryRoot, spec, setup, candidate, env, timeoutMs });
    }
    if (spec.mutantId === 'T5') {
      return runCandidateT5({ repositoryRoot, spec, setup, candidate, env, timeoutMs });
    }
    if (spec.mutantId === 'T11') {
      return runCandidateT11({ repositoryRoot, spec, setup, candidate, env, timeoutMs });
    }
    if (spec.mutantId === 'T12') {
      return runCandidateT12({ repositoryRoot, spec, setup, candidate, env, timeoutMs });
    }
    if (spec.mutantId === 'T16') {
      if (candidate.candidate === 'Temporal TypeScript') {
        return runTemporalCandidateT16({ repositoryRoot, spec, setup, env, timeoutMs });
      }
      return runCandidateT16({ repositoryRoot, spec, setup, candidate, env, timeoutMs });
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
