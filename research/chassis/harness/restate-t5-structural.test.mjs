import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterDir = path.resolve(here, '..', 'adapters', 'restate-ts');
const files = [
  't5-control.mjs',
  't5-workflow.mjs',
  't5-service-process.mjs',
  't5-two-worker-driver.mjs'
];

test('Restate T5 structural slice parses without resolving runtime dependencies', () => {
  for (const name of files) {
    const file = path.join(adapterDir, name);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test('Restate T5 driver encodes the live ownership schedule and fails closed on unproven stale transport', async () => {
  const driver = await readFile(path.join(adapterDir, 't5-two-worker-driver.mjs'), 'utf8');
  assert.match(driver, /\/pause/);
  assert.match(driver, /resume\?deployment=latest/);
  assert.match(driver, /\/restate\/output\//);
  assert.match(driver, /outputAfterStale\.status === 470/);
  assert.match(driver, /attempted: staleTransportFinished/);
  assert.match(driver, /newAuthorityStillCurrentAfterStaleAttempt: staleTransportFinished && outputStillNotReady/);
  assert.match(driver, /finalResult\?\.completedByVariant === 'B'/);
  assert.match(driver, /worker-A-ready/);
  assert.match(driver, /new-authority-acquired-and-held/);
  assert.match(driver, /stale-completion-attempted/);
  assert.match(driver, /post-stale-authority-inspected/);
  assert.match(driver, /new-authority-completion-attempted/);
});

test('Restate T5 uses two concrete child service processes and explicit release controls', async () => {
  const driver = await readFile(path.join(adapterDir, 't5-two-worker-driver.mjs'), 'utf8');
  const service = await readFile(path.join(adapterDir, 't5-service-process.mjs'), 'utf8');
  assert.match(driver, /spawnService\('A'/);
  assert.match(driver, /spawnService\('B'/);
  assert.match(driver, /restate-service-A-pid:/);
  assert.match(driver, /restate-service-B-pid:/);
  assert.match(driver, /releaseCompletion\(serviceA\)/);
  assert.match(driver, /releaseCompletion\(serviceB\)/);
  assert.match(service, /t5_http_response_finished/);
  assert.match(service, /release-completion/);
});
