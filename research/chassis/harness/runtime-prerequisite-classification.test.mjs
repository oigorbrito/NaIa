import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimePrerequisiteFailure as commonRunnerClassifier } from './common-runner-run-hook.mjs';
import { runtimePrerequisiteFailure as t11Classifier } from './t11-run-hook.mjs';
import { runtimePrerequisiteFailure as t12Classifier } from './t12-run-hook.mjs';
import { runtimePrerequisiteFailure as t16Classifier } from './t16-run-hook.mjs';
import { runtimePrerequisiteFailure as temporalT16Classifier } from './t16-temporal-run-hook.mjs';

const classifiers = Object.freeze([
  ['common-runner', commonRunnerClassifier],
  ['T11', t11Classifier],
  ['T12', t12Classifier],
  ['T16', t16Classifier],
  ['Temporal T16', temporalT16Classifier]
]);

const positiveControls = Object.freeze([
  { stdout: '', stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@temporalio/client' imported from /repo/driver.mjs", timedOut: false },
  { stdout: '', stderr: "Error: Cannot find module '@dbos-inc/dbos-sdk'", timedOut: false },
  { stdout: '', stderr: 'Error: connect ECONNREFUSED 127.0.0.1:7233', timedOut: false },
  { stdout: '', stderr: 'Error: spawn temporal ENOENT', timedOut: false }
]);

const negativeControls = Object.freeze([
  { stdout: '', stderr: 'Error: --output is required', timedOut: false },
  { stdout: '', stderr: 'Error: objectiveId is required', timedOut: false },
  { stdout: '', stderr: "ENOENT: no such file or directory, open '/tmp/evidence.json'", timedOut: false },
  { stdout: '', stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/repo/local-driver-helper.mjs' imported from /repo/driver.mjs", timedOut: false },
  { stdout: '', stderr: 'AssertionError: stale completion unexpectedly became authoritative', timedOut: false },
  { stdout: '', stderr: 'Error: connect ECONNREFUSED 127.0.0.1:7233', timedOut: true }
]);

test('runtime prerequisite classifiers recognize explicit external prerequisite failures', () => {
  for (const [name, classify] of classifiers) {
    for (const control of positiveControls) {
      assert.equal(classify(control), true, `${name}: ${control.stderr}`);
    }
  }
});

test('runtime prerequisite classifiers do not mask harness contract errors as BLOCKED', () => {
  for (const [name, classify] of classifiers) {
    for (const control of negativeControls) {
      assert.equal(classify(control), false, `${name}: ${control.stderr}`);
    }
  }
});
