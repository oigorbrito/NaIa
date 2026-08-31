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
  const dir = await mkdtemp(path.join(tmpdir(), 'naia-t15-'));
  const output = path.join(dir, 'evidence.json');
  const child = spawn(process.execPath, [
    runner,
    '--adapter', adapter,
    '--candidate', mutant ? 'control-blind-retry' : 'control-reconcile',
    '--mode', 'local-process',
    '--mutant', 'T15',
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

test('T15 reconciliation control completes without reapplying non-idempotent effect', async () => {
  const result = await run(false);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.mutant, 'T15');
  assert.equal(result.evidence.checks.nonIdempotentProviderInjected, true);
  assert.equal(result.evidence.checks.responseLossInjected, true);
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 1);
  assert.equal(result.evidence.mutants.T15_non_idempotent_provider, 'PASS');
});

test('T15 blind retry control fails after duplicating non-idempotent effect', async () => {
  const result = await run(true);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.evidence.verdict, 'FAIL');
  assert.equal(result.evidence.checks.nonIdempotentProviderInjected, true);
  assert.equal(result.evidence.checks.noDuplicateExternalEffect, false);
  assert.equal(result.evidence.oracle.totalApplyCount, 2);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 1);
  assert.equal(result.evidence.mutants.T15_non_idempotent_provider, 'FAIL');
});
