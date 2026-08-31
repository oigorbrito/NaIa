import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectCandidateSetup } from './candidate-setup.mjs';

async function fixture({ installed = true, installedVersion = '1.2.3', declaredVersion = '1.2.3', envRequired = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-setup-'));
  const adapterDir = path.join(root, 'adapter');
  const harnessDir = path.join(root, 'harness');
  await mkdir(adapterDir, { recursive: true });
  await mkdir(harnessDir, { recursive: true });
  await writeFile(path.join(adapterDir, 'adapter.mjs'), 'export default {}\n');
  await writeFile(path.join(harnessDir, 'executor.mjs'), 'export default {}\n');
  await writeFile(path.join(adapterDir, 'package.json'), JSON.stringify({ dependencies: { '@example/sdk': declaredVersion } }));
  if (installed) {
    const installedDir = path.join(adapterDir, 'node_modules', '@example', 'sdk');
    await mkdir(installedDir, { recursive: true });
    await writeFile(path.join(installedDir, 'package.json'), JSON.stringify({ name: '@example/sdk', version: installedVersion }));
  }
  const candidate = {
    candidate: 'Example', version: '1.2.3', source_ref: 'example/sdk v1.2.3', execution_package: { '@example/sdk': '1.2.3' },
    package_manifest: 'adapter/package.json', adapter: 'adapter/adapter.mjs', mode: 'local-process',
    required_env: envRequired ? ['EXAMPLE_TOKEN'] : [], worker_authority_boundary: 'example worker', blocker: 'B001'
  };
  return { root, candidate, harnessPath: path.join(root, 'harness', 'executor.mjs') };
}

async function withFixture(options, fn) {
  const value = await fixture(options);
  try { return await fn(value); } finally { await rm(value.root, { recursive: true, force: true }); }
}

test('setup is READY only when exact dependency is actually installed', async () => {
  await withFixture({}, async ({ root, candidate, harnessPath }) => {
    const result = await inspectCandidateSetup({ candidate, repositoryRoot: root, harnessPath, env: {} });
    assert.equal(result.status, 'READY');
    assert.equal(result.blocker, null);
    assert.equal(result.diagnostics.packageChecks[0].declaredExact, true);
    assert.equal(result.diagnostics.packageChecks[0].installedExact, true);
    assert.match(result.adapterSha256, /^[a-f0-9]{64}$/);
    assert.match(result.harnessSha256, /^[a-f0-9]{64}$/);
  });
});

test('declared package pin without installed artifact is BLOCKED_SETUP', async () => {
  await withFixture({ installed: false }, async ({ root, candidate, harnessPath }) => {
    const result = await inspectCandidateSetup({ candidate, repositoryRoot: root, harnessPath, env: {} });
    assert.equal(result.status, 'BLOCKED_SETUP');
    assert.match(result.blocker, /DEPENDENCY_NOT_INSTALLED/);
    assert.equal(result.diagnostics.packageChecks[0].declaredExact, true);
    assert.equal(result.diagnostics.packageChecks[0].installedPresent, false);
  });
});

test('installed version mismatch is BLOCKED_SETUP, not silently accepted', async () => {
  await withFixture({ installedVersion: '9.9.9' }, async ({ root, candidate, harnessPath }) => {
    const result = await inspectCandidateSetup({ candidate, repositoryRoot: root, harnessPath, env: {} });
    assert.equal(result.status, 'BLOCKED_SETUP');
    assert.match(result.blocker, /INSTALLED_DEPENDENCY_VERSION_MISMATCH/);
  });
});

test('manifest drift from capability matrix is BLOCKED_SETUP', async () => {
  await withFixture({ declaredVersion: '^1.2.3' }, async ({ root, candidate, harnessPath }) => {
    const result = await inspectCandidateSetup({ candidate, repositoryRoot: root, harnessPath, env: {} });
    assert.equal(result.status, 'BLOCKED_SETUP');
    assert.match(result.blocker, /DEPENDENCY_PIN_MISMATCH/);
  });
});

test('missing required runtime environment is BLOCKED_SETUP', async () => {
  await withFixture({ envRequired: true }, async ({ root, candidate, harnessPath }) => {
    const result = await inspectCandidateSetup({ candidate, repositoryRoot: root, harnessPath, env: {} });
    assert.equal(result.status, 'BLOCKED_SETUP');
    assert.match(result.blocker, /REQUIRED_ENV_MISSING/);
    assert.deepEqual(result.parameters.missingEnvNames, ['EXAMPLE_TOKEN']);
  });
});
