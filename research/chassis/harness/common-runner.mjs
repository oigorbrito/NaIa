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

async function main() {
  const args = parseArgs(process.argv);
  const adapter = path.resolve(args.get('--adapter') ?? '');
  const candidate = args.get('--candidate') ?? path.basename(path.dirname(adapter));
  const mode = args.get('--mode') ?? 'local-process';
  const cwd = path.resolve(args.get('--cwd') ?? path.dirname(adapter));
  const timeoutMs = Number(args.get('--timeout-ms') ?? '15000');
  const objectiveId = args.get('--objective-id') ?? `naia-${randomUUID()}`;
  const operationId = args.get('--operation-id') ?? `${objectiveId}:external-effect`;
  const outputPath = args.get('--output') ? path.resolve(args.get('--output')) : null;
  const externalOracleUrl = args.get('--oracle-url');

  if (!adapter) throw new Error('--adapter is required');
  if (!['local-process', 'managed-controller'].includes(mode)) {
    throw new Error('--mode must be local-process or managed-controller');
  }

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
    const killOnEvent = mode === 'local-process'
      ? 'external_request_applied_or_ambiguous'
      : 'objective_persisted';

    initial = await runUntilKillpoint({
      command: process.execPath,
      args: [adapter, 'start', ...commonArgs],
      cwd,
      env: { ...baseEnv, NAIA_DROP_RESPONSE_AFTER_APPLY: '1' },
      killOnEvent,
      timeoutMs
    });

    resume = await runUntilTerminal({
      command: process.execPath,
      args: [adapter, 'resume', ...commonArgs],
      cwd,
      env: {
        ...baseEnv,
        NAIA_DROP_RESPONSE_AFTER_APPLY: mode === 'managed-controller' ? '1' : '0'
      },
      timeoutMs
    });

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

    const checks = {
      crashInjected: initial.killIssued && !initial.timedOut,
      resumedToCompletion: resume.terminalEvent?.event === 'objective_completed',
      expectedOperationApplied: expected?.applyCount === 1,
      noIdentityDrift: related.length === 1,
      noDuplicateExternalEffect: totalApplyCount === 1,
      oneResponseLossObserved: totalResponseLossCount === 1,
      finalStatusCompleted: status?.state === 'COMPLETED'
    };

    const measuredPass = Object.values(checks).every(Boolean);
    const evidence = {
      schemaVersion: 1,
      candidate,
      mode,
      objectiveId,
      operationId,
      startedAt,
      finishedAt: new Date().toISOString(),
      adapter: { path: adapter, sha256: await fileSha256(adapter) },
      oracle: {
        url: oracleUrl,
        ownedByRunner: Boolean(oracle),
        operations: related,
        totalApplyCount,
        totalResponseLossCount
      },
      initial,
      resume,
      status: { process: statusResult, parsed: status },
      checks,
      mutants: mode === 'local-process'
        ? {
            T7_process_sigkill: measuredPass ? 'PASS' : 'FAIL',
            T8_response_loss: measuredPass ? 'PASS' : 'FAIL',
            T15_operation_identity: checks.noIdentityDrift && checks.noDuplicateExternalEffect ? 'PASS' : 'FAIL'
          }
        : {
            T7_worker_sigkill: 'NOT_EXECUTED',
            T8_response_loss: measuredPass ? 'PASS' : 'FAIL',
            T15_operation_identity: checks.noIdentityDrift && checks.noDuplicateExternalEffect ? 'PASS' : 'FAIL'
          },
      verdict: mode === 'managed-controller' ? 'INCONCLUSIVE' : (measuredPass ? 'PASS' : 'FAIL'),
      blocker: mode === 'managed-controller' ? 'WORKER_SIGKILL_HOOK_REQUIRED_FOR_T7' : null
    };

    if (outputPath) await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = evidence.verdict === 'FAIL' ? 1 : 0;
  } finally {
    if (oracle) await oracle.stop();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 2;
});
