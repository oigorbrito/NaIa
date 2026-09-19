import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFinanceService,
  createFixtureFinanceProvider,
  createMemoryFinanceStore,
  registerFinanceCapabilities,
} from '../../src/product/finance.mjs';

function fixtures() {
  const store = createMemoryFinanceStore();
  let id = 0;
  const service = createFinanceService({
    store,
    idFactory: () => 'tx-' + ++id,
    now: () => '2026-09-19T12:00:00.000Z',
  });
  const providerA = createFixtureFinanceProvider({
    name: 'ProviderA',
    accounts: [{ id: 'a1', institution: 'Bank A', type: 'CHECKING', currency: 'BRL' }],
    balances: { a1: 1200.5 },
    transactions: [
      { id: 't1', accountId: 'a1', amount: -80, bookedAt: '2026-09-03T10:00:00.000Z', merchant: 'Restaurante Um', status: 'POSTED', category: 'restaurants' },
      { id: 't2', accountId: 'a1', amount: -20, bookedAt: '2026-09-04T10:00:00.000Z', merchant: 'Cafe', status: 'PENDING', category: 'restaurants' },
      { id: 't3', accountId: 'a1', amount: 3000, bookedAt: '2026-09-05T10:00:00.000Z', description: 'salary', status: 'POSTED', category: 'income' },
    ],
  });
  const providerB = createFixtureFinanceProvider({
    name: 'ProviderB',
    accounts: [{ id: 'b1', institution: 'Bank B', type: 'CREDIT_CARD', currency: 'BRL' }],
    balances: { b1: -250.75 },
    transactions: [
      { id: 'x1', accountId: 'b1', amount: -150, bookedAt: '2026-09-10T10:00:00.000Z', merchant: 'Mercado', status: 'POSTED', inferredCategory: 'groceries', categoryConfidence: 0.9 },
    ],
  });
  return { service, store, providerA, providerB };
}

test('normalizes two providers behind the same finance contracts', async () => {
  const { service, providerA, providerB } = fixtures();
  const a = await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerA });
  const b = await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerB });

  assert.equal(a.provider, 'providera');
  assert.equal(b.provider, 'providerb');
  assert.equal(a.importedTransactions, 3);
  assert.equal(b.importedTransactions, 1);
  const balances = await service.balances('u1');
  assert.equal(balances.accounts.length, 2);
  assert.deepEqual(balances.totals, { BRL: 949.75 });
});

test('re-import is idempotent by provider transaction identity', async () => {
  const { service, providerA } = fixtures();
  const first = await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerA });
  const second = await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerA });

  assert.equal(first.importedTransactions, 3);
  assert.equal(second.importedTransactions, 0);
  assert.equal(second.duplicateTransactions, 3);
  assert.equal((await service.transactions('u1')).length, 3);
});

test('spending excludes pending transactions and income', async () => {
  const { service, providerA } = fixtures();
  await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerA });
  const result = await service.spending({ userId: 'u1', month: '2026-09', category: 'restaurants' });
  assert.deepEqual(result, { month: '2026-09', category: 'restaurants', amount: 80 });
});

test('category correction preserves provider fact and stores user override separately', async () => {
  const { service, providerB } = fixtures();
  await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerB });
  const [tx] = await service.transactions('u1');
  const corrected = await service.correctCategory(tx.id, 'supermarket');

  assert.equal(corrected.providerCategory, null);
  assert.equal(corrected.inferredCategory, 'groceries');
  assert.equal(corrected.categoryConfidence, 0.9);
  assert.equal(corrected.userCategoryOverride, 'supermarket');
});

test('budget actual-vs-target is deterministic across period boundaries', async () => {
  const { service, providerA } = fixtures();
  await service.importProviderSnapshot({ userId: 'u1', providerAdapter: providerA });
  await service.setBudget({ userId: 'u1', month: '2026-09', category: 'restaurants', amount: 200 });
  await service.setBudget({ userId: 'u1', month: '2026-10', category: 'restaurants', amount: 100 });

  const september = await service.budgetStatus({ userId: 'u1', month: '2026-09' });
  const october = await service.budgetStatus({ userId: 'u1', month: '2026-10' });
  assert.deepEqual({ actual: september[0].actual, remaining: september[0].remaining, utilization: september[0].utilization }, { actual: 80, remaining: 120, utilization: 0.4 });
  assert.equal(october[0].actual, 0);
});

test('expired and revoked consent fail explicitly instead of returning stale current data', async () => {
  const { service } = fixtures();
  for (const consentState of ['EXPIRED', 'REVOKED']) {
    const provider = createFixtureFinanceProvider({ name: 'x-' + consentState, consentState });
    await assert.rejects(
      service.importProviderSnapshot({ userId: 'u1', providerAdapter: provider }),
      (error) => error.code === 'CONSENT_' + consentState && error.retryable === false,
    );
  }
});

test('provider outage preserves normalized retryability without persisting secrets', async () => {
  const { service, store } = fixtures();
  const provider = createFixtureFinanceProvider({
    name: 'down',
    failWith: { code: 'RATE_LIMITED', message: '429', retryable: true },
  });
  provider.apiToken = 'super-secret-token';

  await assert.rejects(
    service.importProviderSnapshot({ userId: 'u1', providerAdapter: provider }),
    (error) => error.code === 'RATE_LIMITED' && error.retryable === true,
  );
  assert.equal((await store.listAccounts({ userId: 'u1' })).length, 0);
});

test('finance queries register through NaIA capability/policy contracts', () => {
  const { service } = fixtures();
  const definitions = [];
  const naia = {
    registerCapability(definition) { definitions.push(definition); return { name: definition.name, risk: definition.tool.risk }; },
  };
  const registered = registerFinanceCapabilities(naia, { service, userId: 'u1' });

  assert.deepEqual(registered, [
    { name: 'finance.balances', risk: 'SENSITIVE' },
    { name: 'finance.spending', risk: 'SENSITIVE' },
  ]);
  const spending = definitions.find((definition) => definition.name === 'finance.spending');
  assert.equal(spending.rule.match({ title: 'Quanto gastei em restaurantes este mês?' }), true);
  const action = spending.rule.action({ title: 'Quanto gastei em restaurantes este mês?' });
  assert.equal(action.risk, 'SENSITIVE');
  assert.equal(action.requiresApproval, true);
  assert.equal(action.input.category, 'restaurantes');
});
