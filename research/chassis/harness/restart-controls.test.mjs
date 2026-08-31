import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createExternalEffectOracle } from './external-oracle.mjs';
import { runUntilKillpoint } from './crash-controller.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'restart-adapter-control.mjs');

async function runToCompletion({ mode, attempt, oracleUrl, objectiveId }) {
  const child = spawn(process.execPath, [fixture, mode, String(attempt)], {
    env: {
      ...process.env,
      NAIA_ORACLE_URL: oracleUrl,
      NAIA_OBJECTIVE_ID: objectiveId
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const events = [];
  const stderr = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => events.push(JSON.parse(line)));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  rl.close();
  return { ...result, events, stderr: stderr.join('') };
}

async function readOperation(baseUrl, operationId) {
  const response = await fetch(`${baseUrl}/operations/${encodeURIComponent(operationId)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('positive control: restart preserves operation identity and external effect is applied once', async (t) => {
  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  t.after(() => oracle.stop());

  const objectiveId = 'control-positive';
  const first = await runUntilKillpoint({
    command: process.execPath,
    args: [fixture, 'stable', '1'],
    env: {
      ...process.env,
      NAIA_ORACLE_URL: oracleUrl,
      NAIA_OBJECTIVE_ID: objectiveId
    },
    killOnEvent: 'external_request_applied_or_ambiguous',
    timeoutMs: 3000
  });

  assert.equal(first.killIssued, true);
  assert.equal(first.timedOut, false);

  const second = await runToCompletion({ mode: 'stable', attempt: 2, oracleUrl, objectiveId });
  assert.equal(second.code, 0);
  assert.equal(second.events.some((entry) => entry.event === 'objective_completed'), true);

  const operation = await readOperation(oracleUrl, `${objectiveId}:external-effect`);
  assert.equal(operation.requestCount, 2);
  assert.equal(operation.applyCount, 1);
});

test('negative control: attempt-scoped operation identity is detected as duplicate external effect', async (t) => {
  const oracle = createExternalEffectOracle();
  const oracleUrl = await oracle.start();
  t.after(() => oracle.stop());

  const objectiveId = 'control-negative';
  const first = await runUntilKillpoint({
    command: process.execPath,
    args: [fixture, 'mutant', '1'],
    env: {
      ...process.env,
      NAIA_ORACLE_URL: oracleUrl,
      NAIA_OBJECTIVE_ID: objectiveId
    },
    killOnEvent: 'external_request_applied_or_ambiguous',
    timeoutMs: 3000
  });

  assert.equal(first.killIssued, true);

  const second = await runToCompletion({ mode: 'mutant', attempt: 2, oracleUrl, objectiveId });
  assert.equal(second.code, 0);

  const firstOperation = await readOperation(oracleUrl, `${objectiveId}:external-effect:attempt-1`);
  const secondOperation = await readOperation(oracleUrl, `${objectiveId}:external-effect:attempt-2`);

  const totalAppliedEffects = firstOperation.applyCount + secondOperation.applyCount;
  assert.equal(totalAppliedEffects, 2);
  assert.notEqual(totalAppliedEffects, 1, 'harness must detect the duplicate-effect mutant');
});
