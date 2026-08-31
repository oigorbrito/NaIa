import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'common-runner.mjs');
const adapter = path.join(here, 'fixtures', 'contract-adapter-control.mjs');

async function run(mutant, blocked = false, noKillpoint = false, faultMode = 'COMPOSITE') {
  const dir = await mkdtemp(path.join(tmpdir(), 'naia-runner-'));
  const output = path.join(dir, 'evidence.json');
  const child = spawn(process.execPath, [
    runner,
    '--adapter', adapter,
    '--candidate', mutant ? 'control-mutant' : 'control-stable',
    '--mode', 'local-process',
    '--mutant', faultMode,
    '--timeout-ms', '5000',
    '--output', output
  ], {
    env: {
      ...process.env,
      NAIA_CONTROL_MUTANT: mutant ? '1' : '0',
      NAIA_CONTROL_BLOCKED: blocked ? '1' : '0',
      NAIA_CONTROL_NO_KILLPOINT: noKillpoint ? '1' : '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const evidence = JSON.parse(await readFile(output, 'utf8'));
  await rm(dir, { recursive: true, force: true });
  return { exitCode, evidence, stderr };
}

test('common runner passes stable identity through response loss and SIGKILL', async () => {
  const result = await run(false);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.checks.noIdentityDrift, true);
  assert.equal(result.evidence.mutants.T7_process_sigkill, 'PASS');
  assert.equal(result.evidence.mutants.T8_response_loss, 'PASS');
  assert.equal(result.evidence.mutants.T15_operation_identity, 'PASS');
});

test('common runner rejects identity drift even when adapter reports completion', async () => {
  const result = await run(true);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.evidence.verdict, 'FAIL');
  assert.equal(result.evidence.checks.resumedToCompletion, true);
  assert.equal(result.evidence.checks.noIdentityDrift, false);
  assert.equal(result.evidence.checks.noDuplicateExternalEffect, false);
  assert.equal(result.evidence.oracle.totalApplyCount, 2);
  assert.equal(result.evidence.mutants.T15_operation_identity, 'FAIL');
});

test('common runner classifies missing runtime prerequisite as BLOCKED, not FAIL', async () => {
  const result = await run(false, true);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.evidence.verdict, 'BLOCKED');
  assert.equal(result.evidence.blocker, 'PREREQUISITE_OR_BOOTSTRAP_FAILED_BEFORE_FAULT');
  assert.equal(result.evidence.oracle.totalApplyCount, 0);
  assert.equal(result.evidence.mutants.T7_process_sigkill, 'BLOCKED');
  assert.equal(result.evidence.mutants.T8_response_loss, 'BLOCKED');
  assert.equal(result.evidence.mutants.T15_operation_identity, 'BLOCKED');
});

test('common runner classifies a run that never reaches the killpoint as INCONCLUSIVE', async () => {
  const result = await run(false, false, true);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.evidence.verdict, 'INCONCLUSIVE');
  assert.equal(result.evidence.blocker, 'KILLPOINT_NOT_REACHED_BEFORE_PROCESS_EXIT_OR_TIMEOUT');
  assert.equal(result.evidence.checks.crashInjected, false);
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.mutants.T7_process_sigkill, 'INCONCLUSIVE');
  assert.equal(result.evidence.mutants.T8_response_loss, 'INCONCLUSIVE');
  assert.equal(result.evidence.mutants.T15_operation_identity, 'INCONCLUSIVE');
});

test('isolated T7 kills after external apply without response-loss contamination', async () => {
  const result = await run(false, false, false, 'T7');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.mutant, 'T7');
  assert.equal(result.evidence.checks.crashInjected, true);
  assert.equal(result.evidence.checks.responseLossInjected, false);
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 0);
  assert.equal(result.evidence.mutants.T7_process_sigkill, 'PASS');
  assert.equal(result.evidence.mutants.T8_response_loss, 'NOT_EXECUTED');
});

test('isolated T8 loses one response and recovers without process SIGKILL', async () => {
  const result = await run(false, false, false, 'T8');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.mutant, 'T8');
  assert.equal(result.evidence.checks.crashInjected, false);
  assert.equal(result.evidence.checks.responseLossInjected, true);
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 1);
  assert.equal(result.evidence.resume.skipped, true);
  assert.equal(result.evidence.mutants.T7_process_sigkill, 'NOT_EXECUTED');
  assert.equal(result.evidence.mutants.T8_response_loss, 'PASS');
});
