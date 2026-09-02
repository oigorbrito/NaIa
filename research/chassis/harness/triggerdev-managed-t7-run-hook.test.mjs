import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessTriggerKilledContainerInspection,
  assessTriggerRunnerContainerInspection,
  triggerRunnerName
} from './triggerdev-managed-t7-run-hook.mjs';
import { FORMAL_EXECUTOR_SUPPORT, formalExecutorSupportsCandidate } from './formal-executor-support.mjs';

test('Trigger.dev runner name matches frozen supervisor naming for first and retry attempts', () => {
  assert.equal(triggerRunnerName('run_abc123', 1), 'runner-abc123');
  assert.equal(triggerRunnerName('run_abc123', 2), 'runner-abc123-attempt-2');
});

test('worker-container inspection requires exact run and runner identity plus host PID', () => {
  const inspection = {
    Id: 'container-123',
    Name: '/runner-abc123',
    State: { Running: true, Pid: 4242 },
    Config: { Env: ['TRIGGER_RUN_ID=run_abc123', 'TRIGGER_RUNNER_ID=runner-abc123'] }
  };
  const result = assessTriggerRunnerContainerInspection(inspection, 'run_abc123', 1);
  assert.equal(result.valid, true);
  assert.equal(result.containerId, 'container-123');
  assert.equal(result.hostPid, 4242);
});

test('supervisor/controller container cannot masquerade as workload runner', () => {
  const inspection = {
    Id: 'supervisor-container',
    Name: '/supervisor',
    State: { Running: true, Pid: 3131 },
    Config: { Env: ['TRIGGER_RUN_ID=run_abc123', 'TRIGGER_RUNNER_ID=runner-abc123'] }
  };
  const result = assessTriggerRunnerContainerInspection(inspection, 'run_abc123', 1);
  assert.equal(result.valid, false);
  assert.equal(result.checks.exactRunnerName, false);
});

test('wrong Trigger run identity fails closed even when container name matches', () => {
  const inspection = {
    Id: 'container-123',
    Name: '/runner-abc123',
    State: { Running: true, Pid: 4242 },
    Config: { Env: ['TRIGGER_RUN_ID=run_other', 'TRIGGER_RUNNER_ID=runner-abc123'] }
  };
  const result = assessTriggerRunnerContainerInspection(inspection, 'run_abc123', 1);
  assert.equal(result.valid, false);
  assert.equal(result.checks.exactRunIdentity, false);
});

test('worker SIGKILL confirmation requires same container stopped and original PID gone', () => {
  const result = assessTriggerKilledContainerInspection({
    Id: 'container-123',
    State: { Running: false, Pid: 0 }
  }, 'container-123', 4242);
  assert.equal(result.valid, true);
});

test('docker kill command cannot manufacture fault evidence while container remains running', () => {
  const result = assessTriggerKilledContainerInspection({
    Id: 'container-123',
    State: { Running: true, Pid: 4242 }
  }, 'container-123', 4242);
  assert.equal(result.valid, false);
  assert.equal(result.checks.notRunning, false);
  assert.equal(result.checks.originalHostPidNoLongerActiveInContainer, false);
});

test('post-kill observation of a different container fails closed', () => {
  const result = assessTriggerKilledContainerInspection({
    Id: 'container-other',
    State: { Running: false, Pid: 0 }
  }, 'container-123', 4242);
  assert.equal(result.valid, false);
  assert.equal(result.checks.exactContainerIdentity, false);
});

test('formal T7 executor matrix admits Trigger.dev managed-controller only after worker-container hook exists', () => {
  assert.equal(formalExecutorSupportsCandidate(FORMAL_EXECUTOR_SUPPORT, 'T7', {
    candidate: 'Trigger.dev',
    mode: 'managed-controller'
  }), true);
});
