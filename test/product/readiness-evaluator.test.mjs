import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMvpReadiness } from '../../src/product/readiness-evaluator.mjs';
import { MVP_READINESS_MANIFEST } from '../../src/product/readiness-manifest.mjs';
import { resolveRuntimeCommit } from '../../src/product/runtime-identity.mjs';

const commit = 'abc123';
const clean = () => ({
  status: 'PASS',
  cleanClone: true,
  requestedCommit: commit,
  checkedOutCommit: commit,
  npmCi: 'PASS',
  npmTest: 'PASS',
  diffCheck: 'PASS',
});
const gate = (name) => ({ status: 'PASS', gate: name, commit });

function baseline(overrides = {}) {
  return evaluateMvpReadiness({
    commit,
    observedProductTests: 78,
    suiteExitCode: 0,
    cleanRun1: clean(),
    cleanRun2: clean(),
    externalScheduler: gate('EXTERNAL_SCHEDULER_DELIVERY'),
    liveProviderEvent: gate('LIVE_PROVIDER_EVENT'),
    liveGoogleCalendarRead: null,
    generatedAt: '2026-09-11T12:00:00.000Z',
    ...overrides,
  });
}

test('readiness passes only when every historical core gate passes', () => {
  const result = baseline();
  assert.equal(result.mvpCoreReady, 'PASS');
  assert.equal(result.localSuite, 'PASS');
  assert.equal(result.liveGoogleCalendarRead, 'BLOCKED_EXTERNAL_OR_NOT_EXECUTED');
});

test('suite with wrong observed test count fails closed even with exit code zero', () => {
  const result = baseline({ observedProductTests: 77 });
  assert.equal(result.localSuite, 'FAIL');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('skipped suite cannot satisfy MVP readiness', () => {
  const result = baseline({ suiteExecuted: false, observedProductTests: null, suiteExitCode: null });
  assert.equal(result.localSuite, 'NOT_EXECUTED');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('clean reproduction from another commit is stale, not pass', () => {
  const stale = clean();
  stale.checkedOutCommit = 'old';
  const result = baseline({ cleanRun1: stale });
  assert.equal(result.cleanReproduction1, 'STALE_RECEIPT');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('live scheduler receipt from another commit is stale, not pass', () => {
  const stale = gate('EXTERNAL_SCHEDULER_DELIVERY');
  stale.commit = 'old';
  const result = baseline({ externalScheduler: stale });
  assert.equal(result.externalScheduler, 'STALE_RECEIPT');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('wrong live gate name fails closed', () => {
  const wrong = gate('OTHER_GATE');
  const result = baseline({ liveProviderEvent: wrong });
  assert.equal(result.liveProviderEvent, 'FAIL');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('Google Calendar live failure does not redefine historical core MVP readiness', () => {
  const failedGoogle = { status: 'FAIL', gate: 'LIVE_GCAL_READ', commit };
  const result = baseline({ liveGoogleCalendarRead: failedGoogle });
  assert.equal(result.liveGoogleCalendarRead, 'FAIL');
  assert.equal(result.mvpCoreReady, 'PASS');
});

test('readiness manifest freezes the historical core gate set', () => {
  assert.deepEqual(MVP_READINESS_MANIFEST.coreGates, [
    'LOCAL_PRODUCT_SUITE',
    'CLEAN_REPRODUCTION_1',
    'CLEAN_REPRODUCTION_2',
    'EXTERNAL_SCHEDULER_DELIVERY',
    'LIVE_PROVIDER_EVENT',
  ]);
  assert.deepEqual(MVP_READINESS_MANIFEST.optionalCapabilityGates, ['LIVE_GCAL_READ']);
  assert.equal(MVP_READINESS_MANIFEST.expectedProductTests, 78);
  assert.equal(Object.isFrozen(MVP_READINESS_MANIFEST), true);
});

test('readiness evaluator defaults expected test count from the manifest', () => {
  const result = evaluateMvpReadiness({
    commit,
    observedProductTests: 78,
    suiteExitCode: 0,
    suiteExecuted: true,
  });
  assert.equal(result.expectedProductTests, 78);
  assert.equal(result.readinessSchemaVersion, 1);
  assert.equal(result.localSuite, 'PASS');
  assert.equal(result.mvpCoreReady, 'NOT_READY');
});

test('runtime commit identity prefers explicit NAIA_COMMIT_SHA', () => {
  const resolved = resolveRuntimeCommit({ env: { NAIA_COMMIT_SHA: ' explicit-sha ' }, cwd: process.cwd() });
  assert.equal(resolved, 'explicit-sha');
});

test('runtime commit identity fails closed outside git when no explicit commit exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'naia-runtime-identity-'));
  try {
    const resolved = resolveRuntimeCommit({ env: {}, cwd: root });
    assert.equal(resolved, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
