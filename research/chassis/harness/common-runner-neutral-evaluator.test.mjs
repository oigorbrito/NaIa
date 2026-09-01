import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'common-runner.mjs');
const adapter = path.join(here, 'fixtures', 'contract-adapter-control.mjs');
const cwd = path.dirname(adapter);

async function execute(mutant) {
  const child = spawn(process.execPath, [
    runner,
    '--adapter', adapter,
    '--candidate', 'neutral-control',
    '--mode', 'local-process',
    '--mutant', mutant,
    '--cwd', cwd,
    '--timeout-ms', '2000'
  ], {
    cwd: here,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  let evidence;
  try {
    evidence = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`common runner did not emit JSON for ${mutant}: ${error}; stderr=${stderr}; stdout=${stdout}`);
  }
  return { ...result, evidence, stderr };
}

test('common runner T7 diagnostic verdict is delegated to neutral evaluator', { timeout: 10000 }, async () => {
  const result = await execute('T7');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.initial.killIssued, true);
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 0);
  assert.equal(result.evidence.neutralCriticalEvaluation.valid, true);
  assert.equal(result.evidence.neutralCriticalEvaluation.passed, true);
  assert.deepEqual(result.evidence.neutralCriticalEvaluation.checks, {
    responseLossNotInjected: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});

test('common runner T8 diagnostic verdict is delegated to same neutral evaluator', { timeout: 10000 }, async () => {
  const result = await execute('T8');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.evidence.verdict, 'PASS');
  assert.equal(result.evidence.oracle.totalApplyCount, 1);
  assert.equal(result.evidence.oracle.totalResponseLossCount, 1);
  assert.equal(result.evidence.resume.skipped, true);
  assert.equal(result.evidence.neutralCriticalEvaluation.valid, true);
  assert.equal(result.evidence.neutralCriticalEvaluation.passed, true);
  assert.deepEqual(result.evidence.neutralCriticalEvaluation.checks, {
    measurementCutoffNotReached: true,
    exactlyOneExternalApply: true,
    stableOperationIdentity: true,
    durableAuthorityReachable: true,
    recoveredToCompletion: true,
    finalStatusCompleted: true
  });
});
