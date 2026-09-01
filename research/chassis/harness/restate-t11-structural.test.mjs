import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterDir = path.resolve(here, '..', 'adapters', 'restate-ts');
const files = ['t11-workflow.mjs', 't11-service-process.mjs', 't11-driver.mjs'];

test('Restate T11 structural slice parses without resolving runtime dependencies', () => {
  for (const name of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(adapterDir, name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test('Restate T11 proves durable native cancellation before killing the old service process', async () => {
  const driver = await readFile(path.join(adapterDir, 't11-driver.mjs'), 'utf8');
  const cancelSubmitted = driver.indexOf("schedule.push('cancel-submitted')");
  const nativeCancel = driver.indexOf('const nativeCancel = await waitForEvent');
  const terminalBeforeCrash = driver.indexOf('const terminalBeforeCrash = await waitForTerminalWorkflowOutput');
  const cancelDurable = driver.indexOf('const cancelDurable = terminalBeforeCrash.status === 409');
  const durableBarrier = driver.indexOf("schedule.push('cancel-authority-durable')");
  const kill = driver.indexOf("serviceA.child.kill('SIGKILL')");

  assert.ok(cancelSubmitted >= 0);
  assert.ok(nativeCancel > cancelSubmitted);
  assert.ok(terminalBeforeCrash > nativeCancel);
  assert.ok(cancelDurable > terminalBeforeCrash);
  assert.ok(durableBarrier > cancelDurable);
  assert.ok(kill > durableBarrier);
  assert.match(driver, /nativeCancel\?\.error\?\.name === 'CancelledError'/);
  assert.match(driver, /terminalBeforeCrash\.status === 409/);
});

test('Restate T11 recovery challenge requires a distinct deployment and completed-invocation rejection', async () => {
  const driver = await readFile(path.join(adapterDir, 't11-driver.mjs'), 'utf8');
  const kill = driver.indexOf("serviceA.child.kill('SIGKILL')");
  const startB = driver.indexOf("spawnService('B'");
  const deploymentCheck = driver.indexOf('deploymentA === deploymentB');
  const resume = driver.indexOf('resume?deployment=latest');
  const completedRejection = driver.indexOf('const resumeCompletedRejection =');
  const finalRead = driver.indexOf('const terminalAfterRecovery = await waitForTerminalWorkflowOutput');

  assert.ok(startB > kill);
  assert.ok(deploymentCheck > startB);
  assert.ok(resume > deploymentCheck);
  assert.ok(completedRejection > resume);
  assert.ok(finalRead > completedRejection);
  assert.match(driver, /resumeResponse\.status === 409/);
  assert.match(driver, /\/completed\/i\.test\(resumeResponse\.text/);
  assert.match(driver, /\/cannot be resumed\|can be resumed only\/i\.test\(resumeResponse\.text/);
  assert.doesNotMatch(driver, /resumeResponse\.ok === false/);
});

test('Restate T11 workflow observes cancellation-specific SDK error before protected progress', async () => {
  const workflow = await readFile(path.join(adapterDir, 't11-workflow.mjs'), 'utf8');
  const sleepAwait = workflow.indexOf('await cancellationPoint');
  const cancelledError = workflow.indexOf('error instanceof restate.CancelledError');
  const rethrow = workflow.indexOf('throw error');
  const protectedOperation = workflow.indexOf("ctx.run('post-cancel-protected-operation'");

  assert.ok(sleepAwait >= 0);
  assert.ok(cancelledError > sleepAwait);
  assert.ok(rethrow > cancelledError);
  assert.ok(protectedOperation > rethrow);
  assert.match(workflow, /t11_native_cancellation_observed/);
  assert.match(workflow, /x-operation-id': input\.operationId/);
});
