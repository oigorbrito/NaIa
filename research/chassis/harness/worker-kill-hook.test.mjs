import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkerKillReceipt } from './worker-kill-hook.mjs';

function validReceipt(overrides = {}) {
  return {
    targetKind: 'worker_process',
    targetIdentity: 'trigger-task-run-process',
    pid: 4242,
    killed: true,
    signal: 'SIGKILL',
    controllerOnly: false,
    durableAuthority: 'trigger-run-engine',
    durableAuthorityAlive: true,
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

test('accepts a confirmed worker-process SIGKILL with durable authority alive', () => {
  const result = validateWorkerKillReceipt(validReceipt());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rejects controller-only death as worker evidence', () => {
  const result = validateWorkerKillReceipt(validReceipt({
    targetKind: 'controller_process',
    controllerOnly: true,
    pid: 1111
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('target_kind_not_worker'));
  assert.ok(result.errors.includes('controller_only_target_forbidden'));
});

test('rejects graceful termination for T7 worker crash evidence', () => {
  const result = validateWorkerKillReceipt(validReceipt({ signal: 'SIGTERM' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('signal_must_be_SIGKILL'));
});

test('rejects a kill that also removed the durable authority', () => {
  const result = validateWorkerKillReceipt(validReceipt({ durableAuthorityAlive: false }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('durable_authority_not_confirmed_alive'));
});

test('container workers require a concrete container identity', () => {
  const invalid = validateWorkerKillReceipt(validReceipt({ targetKind: 'worker_container', pid: undefined, containerId: '' }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('worker_container_id_required'));

  const valid = validateWorkerKillReceipt(validReceipt({ targetKind: 'worker_container', pid: undefined, containerId: 'worker-abc' }));
  assert.equal(valid.valid, true);
});
