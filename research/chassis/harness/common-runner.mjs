import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createExternalEffectOracle } from './external-oracle.mjs';
import { runUntilKillpoint } from './crash-controller.mjs';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i += 2) out.set(argv[i], argv[i + 1]);
  return out;
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return { event: 'unparseable_stdout', raw: line }; }
}

async function fileSha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function runUntilTerminal({ command, args, cwd, env, timeoutMs }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  const stderr = [];
  let terminalEvent = null;
  let timedOut = false;
  let terminationIssued = false;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const parsed = parseLine(line);
    events.push(parsed);
    if (!terminalEvent && ['objective_completed', 'fatal_error'].includes(parsed.event)) {
      terminalEvent = parsed;
      terminationIssued = true;
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
  return { ...result, events, stderr: stderr.join(''), terminalEvent, timedOut, terminationIssued };
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

async function fetchOperations(oracleUrl, ownedOracle) {
  if (ownedOracle) return ownedOracle.snapshotAll();
  const response = await fetch(`${oracleUrl}/operations`);
  if (!response.ok) throw new Error(`oracle operations query failed: ${response.status}`);
  return response.json();
}

function parseStatus(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean).map(parseLine);
  return lines.reverse().find((entry) => typeof entry.state === 'string') ?? null;
}

function prerequisiteFailure(initial, resume, statusResult) {
  const text = [
    initial?.stderr,
    resume?.stderr,
    statusResult?.stderr,
    JSON.stringify(initial?.events ?? []),
    JSON.stringify(resume?.events ?? []),
    statusResult?.stdout
  ].filter(Boolean).join('\n');
  const pattern = /(ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package|ECONNREFUSED|ENOENT|is required)/i;
  return pattern.test(text) ? text : null;
}

function skippedRun(reason) {
  return {
    code: null,
    signal: null,
    events: [],
    stderr: '',
    terminalEvent: null,
    timedOut: false,
    terminationIssued: false,
    skipped: true,
    reason
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const adapterArg = args.get('--adapter');
  if (!adapterArg) throw new Error('--adapter is required');
  const adapter = path.resolve(adapterArg);
  const candidate = args.get('--candidate') ?? path.basename(path.dirname(adapter));
  const mode = args.get('--mode') ?? 'local-process';
  const mutant = args.get('--mutant') ?? 'COMPOSITE';
  const cwd = path.resolve(args.get('--cwd') ?? path.dirname(adapter));
  const timeoutMs = Number(args.get('--timeout-ms') ?? '15000');
  const objectiveId = args.get('--objective-id') ?? `naia-${randomUUID()}`;
  const operationId = args.get('--operation-id') ?? `${objectiveId}:external-effect`;
  const outputPath = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const externalOracleUrl = args.get('--oracle-url');

  if (!['local-process', 'managed-controller'].includes(mode)) throw new Error('--mode must be local-process or managed-controller');
  if (!['COMPOSITE', 'T7', 'T8', 'T15'].includes(mutant)) throw new Error('--mutant must be COMPOSITE, T7, T8, or T15');

  let oracle = null;
  let oracleUrl = externalOracleUrl;
  if (!oracleUrl) {
    if (mode === 'managed-controller') throw new Error('--oracle-url is required for managed-controller mode');
    oracle = createExternalEffectOracle();
    oracleUrl = await oracle.start();
  }

  const startedAt = new Date().toISOString();
  const baseEnv = { ...process.env, NAIA_ORACLE_URL: oracleUrl, NAIA_OBJECTIVE_ID: objectiveId };
  const commonArgs = ['--objective-id', objectiveId, '--operation-id', operationId, '--oracle-url', oracleUrl];
  let initial;
  let resume;
  let statusResult;

  try {
    if (mutant === 'T8') {
      initial = await runUntilTerminal({
        command: process.execPath,
        args: [adapter, 'start', ...commonArgs],
        cwd,
        env: { ...baseEnv, NAIA_DROP_RESPONSE_AFTER_APPLY: '1', NAIA_CONTROL_AUTO_RETRY: '1' },
        timeoutMs
      });
      resume = skippedRun('T8_ISOLATED_DOES_NOT_REQUIRE_PROCESS_RESTART');
    } else {
      const killOnEvent = mutant === 'T7'
        ? 'external_effect_observed_before_checkpoint'
        : mode === 'local-process'
          ? 'external_request_applied_or_ambiguous'
          : 'objective_persisted';
      const injectResponseLoss = mutant === 'T7' ? '0' : '1';
      initial = await runUntilKillpoint({
        command: process.execPath,
        args: [adapter, 'start', ...commonArgs],
        cwd,
        env: {
          ...baseEnv,
          NAIA_DROP_RESPONSE_AFTER_APPLY: injectResponseLoss,
          NAIA_HOLD_AFTER_EXTERNAL_EFFECT: mutant === 'T7' ? '1' : '0'
        },
        killOnEvent,
        timeoutMs
      });

      resume = await runUntilTerminal({
        command: process.execPath,
        args: [adapter, 'resume', ...commonArgs],
        cwd,
        env: {
          ...baseEnv,
          NAIA_DROP_RESPONSE_AFTER_APPLY: mutant === 'COMPOSITE' && mode === 'managed-controller' ? '1' : '0',
          NAIA_HOLD_AFTER_EXTERNAL_EFFECT: '0'
        },
        timeoutMs
      });
    }

    statusResult = await runToExit({
      command: process.execPath,
      args: [adapter, 'status', '--objective-id', objectiveId, '--operation-id', operationId, '--oracle-url', oracleUrl],
      cwd,
      env: baseEnv,
      timeoutMs
    });

    const allOperations = await fetchOperations(oracleUrl, oracle);
    const related = relatedOperations(allOperations, objectiveId);
    const expected = related.find((entry) => entry.operationId === operationId) ?? null;
    const totalApplyCount = related.reduce((sum, entry) => sum + entry.applyCount, 0);
    const totalResponseLossCount = related.reduce((sum, entry) => sum + (entry.responseLossCount ?? 0), 0);
    const status = parseStatus(statusResult.stdout);

    const completionObserved = mutant === 'T8'
      ? initial.terminalEvent?.event === 'objective_completed'
      : resume.terminalEvent?.event === 'objective_completed';

    const checks = {
      crashInjected: Boolean(initial.killIssued && !initial.timedOut),
      responseLossInjected: totalResponseLossCount === 1,
      resumedToCompletion: completionObserved,
      expectedOperationApplied: expected?.applyCount === 1,
      noIdentityDrift: related.length === 1,
      noDuplicateExternalEffect: totalApplyCount === 1,
      oneResponseLossObserved: totalResponseLossCount === 1,
      noUnexpectedResponseLoss: totalResponseLossCount === 0,
      finalStatusCompleted: status?.state === 'COMPLETED'
    };

    const prerequisiteError = related.length === 0 && !initial.killIssued
      ? prerequisiteFailure(initial, resume, statusResult)
      : null;
    const requiredFaultInjected = mutant === 'T8' ? checks.responseLossInjected : checks.crashInjected;
    const faultNotInjected = !prerequisiteError && !requiredFaultInjected
      ? mutant === 'T8' ? 'RESPONSE_LOSS_NOT_OBSERVED' : 'KILLPOINT_NOT_REACHED_BEFORE_PROCESS_EXIT_OR_TIMEOUT'
      : null;
    const workerT7Unavailable = mutant === 'T7' && mode === 'managed-controller';
    const managedComposite = mutant === 'COMPOSITE' && mode === 'managed-controller';
    const inconclusiveReason = workerT7Unavailable || managedComposite
      ? 'WORKER_SIGKILL_HOOK_REQUIRED_FOR_T7'
      : faultNotInjected;

    const measuredPass = mutant === 'T7'
      ? [
          checks.crashInjected,
          checks.resumedToCompletion,
          checks.expectedOperationApplied,
          checks.noIdentityDrift,
          checks.noDuplicateExternalEffect,
          checks.noUnexpectedResponseLoss,
          checks.finalStatusCompleted
        ].every(Boolean)
      : mutant === 'T8'
        ? [
            checks.responseLossInjected,
            checks.resumedToCompletion,
            checks.expectedOperationApplied,
            checks.noIdentityDrift,
            checks.noDuplicateExternalEffect,
            checks.finalStatusCompleted
          ].every(Boolean)
        : [
            checks.crashInjected,
            checks.resumedToCompletion,
            checks.expectedOperationApplied,
            checks.noIdentityDrift,
            checks.noDuplicateExternalEffect,
            checks.oneResponseLossObserved,
            checks.finalStatusCompleted
          ].every(Boolean);

    const verdict = prerequisiteError
      ? 'BLOCKED'
      : inconclusiveReason
        ? 'INCONCLUSIVE'
        : measuredPass ? 'PASS' : 'FAIL';

    const compositeIdentityVerdict = prerequisiteError
      ? 'BLOCKED'
      : faultNotInjected
        ? 'INCONCLUSIVE'
        : checks.noIdentityDrift && checks.noDuplicateExternalEffect ? 'PASS' : 'FAIL';

    const mutants = mode === 'local-process'
      ? {
          T7_process_sigkill: mutant === 'T7' || mutant === 'COMPOSITE' ? verdict : 'NOT_EXECUTED',
          T8_response_loss: mutant === 'T8' ? verdict : mutant === 'COMPOSITE' ? verdict : 'NOT_EXECUTED',
          T15_operation_identity: mutant === 'T15' ? verdict : mutant === 'COMPOSITE' ? compositeIdentityVerdict : 'NOT_EXECUTED'
        }
      : {
          T7_worker_sigkill: 'NOT_EXECUTED',
          T8_response_loss: mutant === 'T8'
            ? verdict
            : mutant === 'COMPOSITE'
              ? (prerequisiteError ? 'BLOCKED' : faultNotInjected ? 'INCONCLUSIVE' : measuredPass ? 'PASS' : 'FAIL')
              : 'NOT_EXECUTED',
          T15_operation_identity: mutant === 'T15' ? verdict : mutant === 'COMPOSITE' ? compositeIdentityVerdict : 'NOT_EXECUTED'
        };

    const evidence = {
      schemaVersion: 1,
      candidate,
      mode,
      mutant,
      objectiveId,
      operationId,
      startedAt,
      finishedAt: new Date().toISOString(),
      adapter: { path: adapter, sha256: await fileSha256(adapter) },
      oracle: { url: oracleUrl, ownedByRunner: Boolean(oracle), operations: related, totalApplyCount, totalResponseLossCount },
      initial,
      resume,
      status: { process: statusResult, parsed: status },
      checks,
      mutants,
      verdict,
      blocker: prerequisiteError
        ? 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT'
        : inconclusiveReason,
      prerequisiteError: prerequisiteError ? prerequisiteError.slice(0, 4000) : null
    };

    if (outputPath) await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = evidence.verdict === 'PASS' ? 0 : evidence.verdict === 'FAIL' ? 1 : 2;
  } finally {
    if (oracle) await oracle.stop();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 2;
});
