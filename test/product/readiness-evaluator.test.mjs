import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMvpReadiness } from '../../src/product/readiness-evaluator.mjs';

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
