import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateProfile, inspectNode, requiredEnvironment } from './runtime-preflight.mjs';

async function makeFixture({ packageVersion = '1.2.3', declaredVersion = '1.2.3' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'naia-preflight-'));
  const adapterDir = path.join(root, 'research', 'chassis', 'adapters', 'fixture');
  const installedDir = path.join(adapterDir, 'node_modules', '@scope', 'sdk');
  await mkdir(installedDir, { recursive: true });
  await writeFile(path.join(adapterDir, 'package.json'), JSON.stringify({
    name: 'fixture',
    private: true,
    dependencies: { '@scope/sdk': declaredVersion }
  }));
  await writeFile(path.join(installedDir, 'package.json'), JSON.stringify({
    name: '@scope/sdk',
    version: packageVersion
  }));
  return root;
}

const fixtureProfile = {
  id: 'fixture-v1',
  candidate: 'Fixture',
  adapter: 'research/chassis/adapters/fixture/adapter.mjs',
  sdkPackages: { '@scope/sdk': '1.2.3' },
  runtimePolicy: { allowedNodeMajors: [Number(process.versions.node.split('.')[0])] }
};

test('preflight is READY only when declared and installed package versions match exactly', async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await evaluateProfile(fixtureProfile, { rootDir: root, checkBootstrap: false });
  assert.equal(result.verdict, 'READY');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.installedPackages[0].actualVersion, '1.2.3');
  assert.equal(result.installedPackages[0].exactVersion, true);
});

test('preflight blocks an installed artifact whose version differs from the frozen profile', async (t) => {
  const root = await makeFixture({ packageVersion: '1.2.4' });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await evaluateProfile(fixtureProfile, { rootDir: root, checkBootstrap: false });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.blockers.includes('INSTALLED_PACKAGE_VERSION_MISMATCH'), true);
});

test('preflight blocks a manifest that silently drifts from the frozen profile', async (t) => {
  const root = await makeFixture({ declaredVersion: '^1.2.3' });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await evaluateProfile(fixtureProfile, { rootDir: root, checkBootstrap: false });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.blockers.includes('DECLARED_PACKAGE_VERSION_MISMATCH'), true);
});

test('node major check is explicit and deterministic', () => {
  assert.equal(inspectNode([22, 24], '22.16.0').pass, true);
  assert.equal(inspectNode([22, 24], '23.1.0').pass, false);
});

test('candidate-specific required environment is checked without exposing values', () => {
  const trigger = requiredEnvironment({ id: 'triggerdev-v4.5.15' }, { TRIGGER_SECRET_KEY: 'secret' });
  assert.deepEqual(trigger, [
    { name: 'NAIA_TRIGGER_PROJECT_REF', present: false },
    { name: 'TRIGGER_SECRET_KEY', present: true }
  ]);
  const dbos = requiredEnvironment({ id: 'dbos-ts-v4.27' }, {});
  assert.deepEqual(dbos, [{ name: 'DBOS_SYSTEM_DATABASE_URL', present: false }]);
});
