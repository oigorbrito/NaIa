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

async function run(mutant) {
  const dir = await mkdtemp(path.join(tmpdir(), 'naia-runner-'));
  const output = path.join(dir, 'evidence.json');
  const child = spawn(process.execPath, [
    runner,
    '--adapter', adapter,
    '--candidate', mutant ? 'control-mutant' : 'control-stable',
    '--mode', 'local-process',
    '--timeout-ms', '5000',
    '--output', output
  ], {
    env: { ...process.env, NAIA_CONTROL_MUTANT: mutant ? '1' : '0' },
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
