import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterDir = path.resolve(here, '..', 'adapters', 'restate-ts');
const files = ['t12-control.mjs', 't12-workflow.mjs', 't12-service-process.mjs', 't12-driver.mjs'];

test('Restate T12 structural slice parses without resolving runtime dependencies', () => {
  for (const name of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(adapterDir, name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test('Restate T12 commits B before releasing stale A and independently re-reads final output', async () => {
  const driver = await readFile(path.join(adapterDir, 't12-driver.mjs'), 'utf8');
  const releaseB = driver.indexOf('releaseCompletion(serviceB)');
  const newCommit = driver.indexOf("schedule.push('new-authority-committed')");
  const releaseA = driver.indexOf('releaseCompletion(serviceA)');
  const staleAttempt = driver.indexOf("schedule.push('stale-completion-attempted-after-new-commit')");
  const finalRead = driver.indexOf('finalAfterStale = await client.workflowOutput()');
  assert.ok(releaseB >= 0 && newCommit > releaseB);
  assert.ok(releaseA > newCommit);
  assert.ok(staleAttempt > releaseA);
  assert.ok(finalRead > staleAttempt);
  assert.match(driver, /staleAttemptActuallyObserved = staleAttemptEvent !== null/);
  assert.match(driver, /attempted: staleAttemptActuallyObserved/);
  assert.match(driver, /rejectedOrNonAuthoritative: staleAttemptActuallyObserved && finalStillB/);
  assert.match(driver, /becameAuthoritative: staleAttemptActuallyObserved && finalAfterStaleValue\?\.completedByVariant === 'A'/);
  assert.doesNotMatch(driver, /attempted: staleTransportFinished/);
});

test('Restate T12 unwraps workflowOutput ready/result envelope before deciding final authority', async () => {
  const driver = await readFile(path.join(adapterDir, 't12-driver.mjs'), 'utf8');
  assert.match(driver, /finalAfterStale\?\.ready === true \? finalAfterStale\.result : finalAfterStale/);
  assert.match(driver, /finalAfterStaleValue\?\.completedByVariant === 'B'/);
  assert.match(driver, /finalAfterStaleValue/);
  assert.doesNotMatch(driver, /const finalStillB = finalAfterStale\?\.completedByVariant/);
});

test('Restate T12 advances authority through native pause/resume and distinct deployments', async () => {
  const driver = await readFile(path.join(adapterDir, 't12-driver.mjs'), 'utf8');
  assert.match(driver, /\/pause/);
  assert.match(driver, /resume\?deployment=latest/);
  assert.match(driver, /deploymentA !== deploymentB/);
  assert.match(driver, /oldAuthorityIdentity = `\$\{invocationId\}:deployment:\$\{deploymentA\}`/);
  assert.match(driver, /newAuthorityIdentity = `\$\{invocationId\}:deployment:\$\{deploymentB\}`/);
  assert.match(driver, /t12_http_response_finished/);
  assert.match(driver, /t12_http_response_closed/);
});
