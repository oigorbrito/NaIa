import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { createExternalEffectOracle } from './external-oracle.mjs';
import { runUntilKillpoint } from './crash-controller.mjs';

function parseLine(line) {
  try { return JSON.parse(line); } catch { return { event: 'unparseable_stdout', raw: line }; }
}

async function runUntilTerminal({ command, args, cwd, env, timeoutMs }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  const stderr = [];
  let terminalEvent = null;
  let timedOut = false;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const parsed = parseLine(line);
    events.push(parsed);
    if (!terminalEvent && ['objective_completed', 'fatal_error', 'reconciliation_required'].includes(parsed.event)) {
      terminalEvent = parsed;
      child.kill('SIGTERM');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  rl.close();
  return { ...result, events, stderr: stderr.join(''), terminalEvent, timedOut };
}

async function runToExit({ command, args, cwd, env, timeoutMs }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  return { ...result, stdout: stdout.join(''), stderr: stderr.join(''), timedOut };
}

function relatedOperations(operations, objectiveId) {
  return operations.filter((entry) => {
    try { return JSON.parse(entry.payload)?.objectiveId === objectiveId; } catch { return false; }
  });
}

function parseStatus(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map(parseLine).reverse().find((entry) => typeof entry.state === 'string') ?? null;
}

function authorityResponsive(statusProcess, status) {
  return statusProcess?.timedOut !== true && statusProcess?.code === 0 && typeof status?.state === 'string';
}

export async function runIsolatedExternalFault({ adapter, candidate, cwd, mutantId, timeoutMs = 15000, env = process.env }) {
  if (!['T7', 'T8'].includes(mutantId)) throw new Error('isolated external fault runner supports only T7 or T8');

  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  const objectiveId = `naia-${mutantId.toLowerCase()}-${randomUUID()}`;
  const operationId = `${objectiveId}:external-effect`;
  const commonArgs = ['--objective-id', objectiveId, '--operation-id', operationId, '--oracle-url', oracleUrl];
  const baseEnv = { ...env, NAIA_ORACLE_URL: oracleUrl, NAIA_OBJECTIVE_ID: objectiveId };

  let initial;
  let resume = null;
  let statusProcess;
  try {
    if (mutantId === 'T7') {
      initial = await runUntilKillpoint({
        command: process.execPath,
        args: [adapter, 'start', ...commonArgs],
        cwd,
        env: { ...baseEnv, NAIA_DROP_RESPONSE_AFTER_APPLY: '0' },
        killOnEvent: 'external_effect_observed_before_checkpoint',
        timeoutMs
      });
      resume = await runUntilTerminal({
        command: process.execPath,
        args: [adapter, 'resume', ...commonArgs],
        cwd,
        env: { ...baseEnv, NAIA_DROP_RESPONSE_AFTER_APPLY: '0' },
        timeoutMs
      });
    } else {
      initial = await runUntilTerminal({
        command: process.execPath,
        args: [adapter, 'start', ...commonArgs],
        cwd,
        env: { ...baseEnv, NAIA_DROP_RESPONSE_AFTER_APPLY: '1' },
        timeoutMs
      });
      // No restart is allowed inside a T8 repetition. If the measurement cutoff kills
      // a non-terminating process, the repetition cannot pass as isolated T8 evidence.
    }

    statusProcess = await runToExit({
      command: process.execPath,
      args: [adapter, 'status', ...commonArgs],
      cwd,
      env: baseEnv,
      timeoutMs
    });

    const related = relatedOperations(oracle.snapshotAll(), objectiveId);
    const totalApplyCount = related.reduce((sum, entry) => sum + entry.applyCount, 0);
    const totalResponseLossCount = related.reduce((sum, entry) => sum + (entry.responseLossCount ?? 0), 0);
    const status = parseStatus(statusProcess.stdout);
    const terminal = resume?.terminalEvent ?? initial?.terminalEvent ?? null;
    const durableAuthorityAlive = authorityResponsive(statusProcess, status);

    const acceptanceChecks = mutantId === 'T7'
      ? {
          crashInjected: initial.killIssued === true && initial.timedOut !== true,
          responseLossNotInjected: totalResponseLossCount === 0,
          exactlyOneExternalApply: totalApplyCount === 1,
          stableOperationIdentity: related.length === 1,
          durableAuthorityResponsiveAfterCrash: durableAuthorityAlive,
          recoveredToTerminalState: ['objective_completed', 'reconciliation_required'].includes(terminal?.event),
          terminalStatusObservable: ['COMPLETED', 'RECONCILIATION_REQUIRED'].includes(status?.state)
        }
      : {
          exactlyOneResponseLoss: totalResponseLossCount === 1,
          measurementCutoffNotReached: initial.timedOut !== true,
          exactlyOneExternalApply: totalApplyCount === 1,
          stableOperationIdentity: related.length === 1,
          durableAuthorityResponsiveAfterResponseLoss: durableAuthorityAlive,
          recoveredToTerminalState: ['objective_completed', 'reconciliation_required'].includes(terminal?.event),
          terminalStatusObservable: ['COMPLETED', 'RECONCILIATION_REQUIRED'].includes(status?.state)
        };

    return {
      fault: mutantId === 'T7'
        ? {
            intended: 'local candidate execution process SIGKILL after external effect before durable result checkpoint',
            injected: initial.killIssued === true && initial.timedOut !== true,
            targetKind: 'worker-process',
            targetIdentity: initial.pid ?? null,
            signal: 'SIGKILL',
            durableAuthorityAlive
          }
        : {
            intended: 'external provider applies effect then response is lost without process crash',
            injected: totalResponseLossCount === 1,
            targetKind: 'provider-response',
            targetIdentity: operationId,
            signal: null,
            durableAuthorityAlive
          },
      workload: { objectiveId, operationId },
      rawObservations: {
        candidate,
        initial,
        resume,
        statusProcess,
        status,
        oracleOperations: related,
        totalApplyCount,
        totalResponseLossCount,
        measurementCutoffKilledProcess: mutantId === 'T8' && initial.timedOut === true
      },
      acceptanceChecks
    };
  } finally {
    await oracle.stop();
  }
}
