import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'common-runner.mjs');
const contractErrorAdapter = path.join(here, 'fixtures', 'contract-error-adapter-control.mjs');

test('common runner does not relabel a harness/adapter contract error as BLOCKED', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'naia-common-prereq-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'evidence.json');
  const child = spawn(process.execPath, [
    runner,
    '--adapter', contractErrorAdapter,
    '--candidate', 'contract-error-control',
    '--mode', 'local-process',
    '--mutant', 'T7',
    '--timeout-ms', '1000',
    '--output', output
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const evidence = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(exitCode, 2, stderr);
  assert.equal(evidence.verdict, 'INCONCLUSIVE');
  assert.equal(evidence.blocker, 'KILLPOINT_NOT_REACHED_BEFORE_PROCESS_EXIT_OR_TIMEOUT');
  assert.equal(evidence.prerequisiteError, null);
  assert.equal(evidence.oracle.totalApplyCount, 0);
});
