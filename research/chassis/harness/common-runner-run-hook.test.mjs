import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCommonRunnerRunHook } from './common-runner-run-hook.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..', '..');
const candidate = {
  candidate: 'Control',
  mode: 'local-process',
  adapter: 'research/chassis/harness/fixtures/contract-adapter-control.mjs'
};
const setup = { adapterSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64) };

test('formal run hook executes isolated T7 through the common runner', async () => {
  const hook = createCommonRunnerRunHook({ repositoryRoot, timeoutMs: 5000 });
  const result = await hook({ candidate: 'Control', mutantId: 'T7' }, setup, candidate);
  assert.equal(result.blocked, false);
  assert.equal(result.fault.intended, 'T7');
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.signal, 'SIGKILL');
  assert.equal(result.fault.durableAuthorityAlive, true);
  assert.equal(Object.values(result.acceptanceChecks).every(Boolean), true);
});

test('formal run hook executes isolated T8 without requiring SIGKILL', async () => {
  const hook = createCommonRunnerRunHook({ repositoryRoot, timeoutMs: 5000 });
  const result = await hook({ candidate: 'Control', mutantId: 'T8' }, setup, candidate);
  assert.equal(result.blocked, false);
  assert.equal(result.fault.intended, 'T8');
  assert.equal(result.fault.injected, true);
  assert.equal(result.fault.signal, null);
  assert.equal(result.fault.durableAuthorityAlive, true);
  assert.equal(Object.values(result.acceptanceChecks).every(Boolean), true);
});

test('managed run hook blocks before fault when worker-reachable oracle URL is absent', async () => {
  const hook = createCommonRunnerRunHook({ repositoryRoot, env: {}, timeoutMs: 5000 });
  const result = await hook(
    { candidate: 'Managed Control', mutantId: 'T8' },
    setup,
    { ...candidate, mode: 'managed-controller' }
  );
  assert.equal(result.blocked, true);
  assert.equal(result.blocker, 'NAIA_EXTERNAL_ORACLE_URL_REQUIRED');
  assert.equal(result.fault.injected, false);
});
