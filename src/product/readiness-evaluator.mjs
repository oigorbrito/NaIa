function cleanReproductionStatus(receipt, commit) {
  if (!receipt) return 'NOT_EXECUTED';
  const pass = receipt.status === 'PASS'
    && receipt.cleanClone === true
    && receipt.requestedCommit === commit
    && receipt.checkedOutCommit === commit
    && receipt.npmCi === 'PASS'
    && receipt.npmTest === 'PASS'
    && receipt.diffCheck === 'PASS';
  if (pass) return 'PASS';
  if (receipt.status === 'PASS'
      && (receipt.requestedCommit !== commit || receipt.checkedOutCommit !== commit)) {
    return 'STALE_RECEIPT';
  }
  return 'FAIL';
}

function liveGateStatus(receipt, gate, commit, missing = 'NOT_EXECUTED') {
  if (!receipt) return missing;
  if (receipt.status === 'PASS' && receipt.gate === gate && receipt.commit === commit) return 'PASS';
  if (receipt.status === 'PASS' && receipt.gate === gate && receipt.commit !== commit) return 'STALE_RECEIPT';
  return 'FAIL';
}

export function evaluateMvpReadiness({
  commit,
  expectedProductTests,
  observedProductTests,
  suiteExitCode,
  suiteExecuted = true,
  cleanRun1 = null,
  cleanRun2 = null,
  externalScheduler = null,
  liveProviderEvent = null,
  liveGoogleCalendarRead = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!commit) throw new Error('commit is required');
  if (!Number.isInteger(expectedProductTests) || expectedProductTests <= 0) {
    throw new Error('expectedProductTests must be a positive integer');
  }

  const localSuite = !suiteExecuted
    ? 'NOT_EXECUTED'
    : suiteExitCode === 0 && observedProductTests === expectedProductTests
      ? 'PASS'
      : 'FAIL';

  const cleanReproduction1 = cleanReproductionStatus(cleanRun1, commit);
  const cleanReproduction2 = cleanReproductionStatus(cleanRun2, commit);
  const scheduler = liveGateStatus(externalScheduler, 'EXTERNAL_SCHEDULER_DELIVERY', commit);
  const providerEvent = liveGateStatus(liveProviderEvent, 'LIVE_PROVIDER_EVENT', commit);
  const google = liveGateStatus(
    liveGoogleCalendarRead,
    'LIVE_GCAL_READ',
    commit,
    'BLOCKED_EXTERNAL_OR_NOT_EXECUTED',
  );

  const coreReady = localSuite === 'PASS'
    && cleanReproduction1 === 'PASS'
    && cleanReproduction2 === 'PASS'
    && scheduler === 'PASS'
    && providerEvent === 'PASS';

  return {
    commit,
    expectedProductTests,
    observedProductTests: observedProductTests ?? null,
    localSuite,
    cleanReproduction1,
    cleanReproduction2,
    externalScheduler: scheduler,
    liveProviderEvent: providerEvent,
    liveGoogleCalendarRead: google,
    mvpCoreReady: coreReady ? 'PASS' : 'NOT_READY',
    generatedAt,
  };
}
