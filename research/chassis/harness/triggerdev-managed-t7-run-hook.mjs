import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { evaluateT7T8Semantics } from './t7-t8-evaluator.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return { event: 'unparseable_stdout', raw: line }; }
}

function relatedOperations(operations, objectiveId) {
  return (operations ?? []).filter((entry) => {
    try { return JSON.parse(entry.payload)?.objectiveId === objectiveId; } catch { return false; }
  });
}

export function triggerRunnerName(runFriendlyId, attemptNumber = 1) {
  if (typeof runFriendlyId !== 'string' || runFriendlyId.length === 0) throw new Error('runFriendlyId is required');
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error('attemptNumber must be a positive integer');
  const parts = ['runner', runFriendlyId.replace('run_', '')];
  if (attemptNumber > 1) parts.push(`attempt-${attemptNumber}`);
  return parts.join('-');
}

function envMap(envList) {
  const out = new Map();
  for (const entry of envList ?? []) {
    const index = String(entry).indexOf('=');
    if (index <= 0) continue;
    out.set(String(entry).slice(0, index), String(entry).slice(index + 1));
  }
  return out;
}

export function assessTriggerRunnerContainerInspection(inspect, runFriendlyId, attemptNumber = 1) {
  const expectedRunnerId = triggerRunnerName(runFriendlyId, attemptNumber);
  const environment = envMap(inspect?.Config?.Env);
  const observedName = String(inspect?.Name ?? '').replace(/^\//, '');
  const observedRunId = environment.get('TRIGGER_RUN_ID') ?? null;
  const observedRunnerId = environment.get('TRIGGER_RUNNER_ID') ?? null;
  const containerId = typeof inspect?.Id === 'string' && inspect.Id.length > 0 ? inspect.Id : null;
  const hostPid = Number.isInteger(inspect?.State?.Pid) && inspect.State.Pid > 0 ? inspect.State.Pid : null;
  const running = inspect?.State?.Running === true;
  const checks = {
    containerIdPresent: Boolean(containerId),
    exactRunnerName: observedName === expectedRunnerId,
    exactRunIdentity: observedRunId === runFriendlyId,
    exactRunnerIdentity: observedRunnerId === expectedRunnerId,
    hostPidPresent: Boolean(hostPid),
    running
  };
  return {
    valid: Object.values(checks).every(Boolean),
    expectedRunnerId,
    observedName,
    observedRunId,
    observedRunnerId,
    containerId,
    hostPid,
    running,
    checks
  };
}

export function assessTriggerKilledContainerInspection(inspect, expectedContainerId, expectedHostPid) {
  const observedContainerId = typeof inspect?.Id === 'string' && inspect.Id.length > 0 ? inspect.Id : null;
  const observedPid = Number.isInteger(inspect?.State?.Pid) ? inspect.State.Pid : null;
  const running = inspect?.State?.Running === true;
  const checks = {
    exactContainerIdentity: Boolean(observedContainerId && observedContainerId === expectedContainerId),
    notRunning: running === false,
    originalHostPidNoLongerActiveInContainer: observedPid === 0 || observedPid === null || observedPid !== expectedHostPid
  };
  return {
    valid: Object.values(checks).every(Boolean),
    observedContainerId,
    observedPid,
    running,
    checks
  };
}

async function runProcess(command, args, { cwd, env, timeoutMs = 5000 } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let timedOut = false;
  let spawnError = null;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => stdout.push(chunk));
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
  child.once('error', (error) => { spawnError = error; });
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, timeoutMs);
  const result = await new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  return {
    ...result,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    timedOut,
    spawnError: spawnError ? String(spawnError) : null
  };
}

async function inspectContainer(nameOrId, env, timeoutMs) {
  const result = await runProcess('docker', ['inspect', nameOrId], { env, timeoutMs });
  if (result.spawnError || result.timedOut || result.code !== 0) return { result, inspect: null };
  try {
    const parsed = JSON.parse(result.stdout);
    return { result, inspect: Array.isArray(parsed) ? parsed[0] ?? null : null };
  } catch {
    return { result, inspect: null };
  }
}

async function killContainer(containerId, env, timeoutMs) {
  return runProcess('docker', ['kill', '--signal', 'KILL', containerId], { env, timeoutMs });
}

async function fetchOperations(oracleUrl) {
  const response = await fetch(`${oracleUrl}/operations`);
  if (!response.ok) throw new Error(`oracle operations query failed: ${response.status}`);
  return response.json();
}

function parseStatus(stdout) {
  return String(stdout ?? '').split(/\r?\n/).filter(Boolean).map(parseLine).reverse().find((entry) => typeof entry.state === 'string') ?? null;
}

function startAdapter(adapter, commonArgs, cwd, env) {
  const child = spawn(process.execPath, [adapter, 'start', ...commonArgs], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const events = [];
  const stderr = [];
  let runFriendlyId = null;
  let terminalEvent = null;
  let spawnError = null;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const event = parseLine(line);
    events.push(event);
    if (event.event === 'objective_persisted' && typeof event.runId === 'string') runFriendlyId = event.runId;
    if (!terminalEvent && ['objective_completed', 'fatal_error', 'reconciliation_required'].includes(event.event)) terminalEvent = event;
  });
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
  child.once('error', (error) => { spawnError = error; });
  const completion = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    events,
    stderr,
    completion,
    close: () => rl.close(),
    snapshot: () => ({
      pid: child.pid ?? null,
      runFriendlyId,
      terminalEvent,
      events: [...events],
      stderr: stderr.join(''),
      spawnError: spawnError ? String(spawnError) : null
    })
  };
}

async function cancelStartedRun(adapterPath, commonArgs, cwd, env, timeoutMs, runFriendlyId) {
  if (!runFriendlyId) return { attempted: false, reason: 'RUN_ID_NOT_OBSERVED' };
  const result = await runProcess(process.execPath, [adapterPath, 'cancel', ...commonArgs], {
    cwd,
    env,
    timeoutMs: Math.min(5000, timeoutMs)
  });
  return {
    attempted: true,
    confirmed: !result.spawnError && !result.timedOut && result.code === 0,
    result
  };
}

function blockedResult({ objectiveId, operationId, blocker, observations }) {
  return {
    blocked: true,
    blocker,
    fault: {
      intended: 'T7',
      injected: false,
      targetKind: 'worker-container-unaddressed',
      targetIdentity: null,
      signal: null,
      durableAuthorityAlive: false
    },
    workload: { objectiveId, operationId },
    rawObservations: observations,
    acceptanceChecks: {}
  };
}

function inconclusiveFaultResult({ objectiveId, operationId, target, observations }) {
  return {
    blocked: false,
    blocker: null,
    fault: {
      intended: 'T7',
      injected: false,
      targetKind: 'worker-container',
      targetIdentity: target?.containerId ?? null,
      signal: 'SIGKILL',
      durableAuthorityAlive: false
    },
    workload: { objectiveId, operationId },
    rawObservations: observations,
    acceptanceChecks: {}
  };
}

export async function runTriggerdevManagedT7({ repositoryRoot, spec, setup, candidate, env = process.env, timeoutMs = 15000 }) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  if (candidate?.candidate !== 'Trigger.dev' || candidate?.mode !== 'managed-controller') {
    throw new Error('runTriggerdevManagedT7 requires Trigger.dev managed-controller candidate');
  }
  const oracleUrl = env.NAIA_EXTERNAL_ORACLE_URL;
  if (!oracleUrl) {
    return blockedResult({
      objectiveId: spec.experimentId,
      operationId: `${spec.experimentId}:external-effect`,
      blocker: 'NAIA_EXTERNAL_ORACLE_URL_REQUIRED',
      observations: { reason: 'MANAGED_WORKER_ORACLE_URL_MISSING' }
    });
  }

  const objectiveId = spec.experimentId;
  const operationId = `${spec.experimentId}:external-effect`;
  const adapterPath = path.join(repositoryRoot, candidate.adapter);
  const cwd = path.dirname(adapterPath);
  const commonArgs = ['--objective-id', objectiveId, '--operation-id', operationId, '--oracle-url', oracleUrl];
  const controller = startAdapter(adapterPath, commonArgs, cwd, {
    ...env,
    NAIA_HOLD_AFTER_EXTERNAL_EFFECT: '1',
    NAIA_HOLD_AFTER_EXTERNAL_EFFECT_MS: String(Math.max(timeoutMs * 3, 30000))
  });
  const deadline = Date.now() + timeoutMs;
  let related = [];
  let runnerAssessment = null;
  let dockerInspectEvidence = null;

  try {
    while (Date.now() < deadline) {
      const snapshot = controller.snapshot();
      if (snapshot.spawnError) {
        return blockedResult({ objectiveId, operationId, blocker: 'TRIGGER_ADAPTER_START_FAILED', observations: { controller: snapshot } });
      }
      try {
        related = relatedOperations(await fetchOperations(oracleUrl), objectiveId);
      } catch (error) {
        const cancellation = await cancelStartedRun(adapterPath, commonArgs, cwd, env, timeoutMs, snapshot.runFriendlyId);
        return blockedResult({ objectiveId, operationId, blocker: 'TRIGGER_ORACLE_QUERY_FAILED', observations: { controller: snapshot, error: String(error), cancellation } });
      }
      const applied = related.find((entry) => entry.operationId === operationId)?.applyCount >= 1;
      if (snapshot.runFriendlyId && applied) {
        const runnerName = triggerRunnerName(snapshot.runFriendlyId, 1);
        dockerInspectEvidence = await inspectContainer(runnerName, env, Math.min(5000, timeoutMs));
        runnerAssessment = assessTriggerRunnerContainerInspection(dockerInspectEvidence.inspect, snapshot.runFriendlyId, 1);
        if (runnerAssessment.valid) break;
      }
      if (snapshot.terminalEvent) break;
      await sleep(100);
    }

    const beforeFault = controller.snapshot();
    if (!runnerAssessment?.valid) {
      if (controller.child.exitCode === null && controller.child.signalCode === null) controller.child.kill('SIGTERM');
      const cancellation = await cancelStartedRun(adapterPath, commonArgs, cwd, env, timeoutMs, beforeFault.runFriendlyId);
      return blockedResult({
        objectiveId,
        operationId,
        blocker: 'TRIGGER_WORKER_CONTAINER_NOT_ADDRESSABLE',
        observations: { controller: beforeFault, dockerInspect: dockerInspectEvidence, runnerAssessment, oracleOperations: related, cancellation }
      });
    }

    const kill = await killContainer(runnerAssessment.containerId, env, Math.min(5000, timeoutMs));
    const killCommandAccepted = !kill.spawnError && !kill.timedOut && kill.code === 0;
    if (!killCommandAccepted) {
      if (controller.child.exitCode === null && controller.child.signalCode === null) controller.child.kill('SIGTERM');
      const cancellation = await cancelStartedRun(adapterPath, commonArgs, cwd, env, timeoutMs, beforeFault.runFriendlyId);
      return blockedResult({
        objectiveId,
        operationId,
        blocker: 'TRIGGER_WORKER_CONTAINER_SIGKILL_UNAVAILABLE',
        observations: { controller: beforeFault, runnerAssessment, kill, cancellation }
      });
    }

    const postKillInspect = await inspectContainer(runnerAssessment.containerId, env, Math.min(5000, timeoutMs));
    const postKillAssessment = assessTriggerKilledContainerInspection(
      postKillInspect.inspect,
      runnerAssessment.containerId,
      runnerAssessment.hostPid
    );
    if (!postKillAssessment.valid) {
      if (controller.child.exitCode === null && controller.child.signalCode === null) controller.child.kill('SIGTERM');
      const cancellation = await cancelStartedRun(adapterPath, commonArgs, cwd, env, timeoutMs, beforeFault.runFriendlyId);
      return inconclusiveFaultResult({
        objectiveId,
        operationId,
        target: runnerAssessment,
        observations: {
          reason: 'TRIGGER_WORKER_SIGKILL_NOT_CONFIRMED',
          controller: beforeFault,
          runnerAssessment,
          kill,
          postKillInspect,
          postKillAssessment,
          cancellation
        }
      });
    }

    let controllerTimedOut = false;
    const controllerExit = await Promise.race([
      controller.completion,
      sleep(timeoutMs).then(() => {
        controllerTimedOut = true;
        if (controller.child.exitCode === null && controller.child.signalCode === null) controller.child.kill('SIGKILL');
        return { code: null, signal: 'SIGKILL' };
      })
    ]);
    const afterFault = controller.snapshot();

    const statusProcess = await runProcess(process.execPath, [adapterPath, 'status', ...commonArgs], {
      cwd,
      env,
      timeoutMs
    });
    const status = parseStatus(statusProcess.stdout);
    const allOperations = await fetchOperations(oracleUrl);
    related = relatedOperations(allOperations, objectiveId);
    const totalApplyCount = related.reduce((sum, entry) => sum + (entry.applyCount ?? 0), 0);
    const totalResponseLossCount = related.reduce((sum, entry) => sum + (entry.responseLossCount ?? 0), 0);
    const durableAuthorityReachable = statusProcess.code === 0 && !statusProcess.timedOut && Boolean(status);
    const semanticEvaluation = evaluateT7T8Semantics('T7', {
      totalApplyCount,
      totalResponseLossCount,
      relatedOperationCount: related.length,
      durableAuthorityReachable,
      terminalEvent: afterFault.terminalEvent?.event ?? null,
      finalStatus: status?.state ?? null,
      measurementCutoffReached: controllerTimedOut
    });

    return {
      blocked: false,
      blocker: null,
      fault: {
        intended: 'T7',
        injected: true,
        targetKind: 'worker-container',
        targetIdentity: runnerAssessment.containerId,
        signal: 'SIGKILL',
        durableAuthorityAlive: durableAuthorityReachable
      },
      workload: { objectiveId, operationId },
      rawObservations: {
        workerProcessPids: [runnerAssessment.hostPid],
        triggerManagedT7: {
          controllerBeforeFault: beforeFault,
          controllerAfterFault: afterFault,
          controllerExit,
          controllerTimedOut,
          runnerAssessment,
          dockerInspect: dockerInspectEvidence,
          kill,
          postKillInspect,
          postKillAssessment,
          oracleOperations: related,
          totalApplyCount,
          totalResponseLossCount,
          status: { process: statusProcess, parsed: status },
          setupIdentity: { adapterSha256: setup.adapterSha256, harnessSha256: setup.harnessSha256 }
        },
        semanticEvaluationValid: semanticEvaluation.valid,
        semanticEvaluationErrors: semanticEvaluation.errors
      },
      acceptanceChecks: semanticEvaluation.checks
    };
  } finally {
    controller.close();
    if (controller.child.exitCode === null && controller.child.signalCode === null) controller.child.kill('SIGTERM');
  }
}
