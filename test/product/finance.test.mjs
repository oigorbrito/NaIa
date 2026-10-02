import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  createFileFinanceStore,
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
    { name: 'finance.spendingChange', risk: 'SENSITIVE' },
    { name: 'finance.recurring', risk: 'SENSITIVE' },
  ]);
  const spending = definitions.find((definition) => definition.name === 'finance.spending');
  assert.equal(spending.rule.match({ title: 'Quanto gastei em restaurantes este mês?' }), true);
  const action = spending.rule.action({ title: 'Quanto gastei em restaurantes este mês?' });
  assert.equal(action.risk, 'SENSITIVE');
  assert.equal(action.requiresApproval, true);
  assert.equal(action.input.category, 'restaurantes');
});

test('finance facts, budgets and provider identity survive file-backed restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-finance-'));
  try{
    let id=0;
    const store=createFileFinanceStore({rootDir:dir});
    const first=createFinanceService({store,idFactory:()=>`tx-${++id}`,now:()=> '2026-09-19T12:00:00Z'});
    const provider=createFixtureFinanceProvider({name:'BankX',accounts:[{id:'a1',institution:'Bank X',type:'CHECKING',currency:'BRL'}],balances:{a1:500},transactions:[{id:'t1',accountId:'a1',amount:-50,bookedAt:'2026-09-19T10:00:00Z',status:'POSTED',category:'food'}]});
    await first.importProviderSnapshot({userId:'u1',providerAdapter:provider});
    await first.setBudget({userId:'u1',month:'2026-09',category:'food',amount:100});
    const second=createFinanceService({store:createFileFinanceStore({rootDir:dir}),now:()=> '2026-09-19T13:00:00Z'});
    assert.deepEqual((await second.balances('u1')).totals,{BRL:500});
    assert.equal((await second.transactions('u1')).length,1);
    assert.equal((await second.budgetStatus({userId:'u1',month:'2026-09'}))[0].actual,50);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('re-import refreshes pending transaction to posted without changing logical id or user category override',async()=>{
  const store=createMemoryFinanceStore();let id=0;
  const service=createFinanceService({store,idFactory:()=>`tx-${++id}`});
  const pending=createFixtureFinanceProvider({name:'bank',accounts:[{id:'a1'}],transactions:[{id:'t1',accountId:'a1',amount:-20,bookedAt:'2026-09-19T10:00:00Z',status:'PENDING',category:'restaurants'}]});
  await service.importProviderSnapshot({userId:'u1',providerAdapter:pending});
  const [before]=await service.transactions('u1');
  await service.correctCategory(before.id,'coffee');
  const posted=createFixtureFinanceProvider({name:'bank',accounts:[{id:'a1'}],transactions:[{id:'t1',accountId:'a1',amount:-20,bookedAt:'2026-09-19T10:00:00Z',status:'POSTED',category:'restaurants'}]});
  const refreshed=await service.importProviderSnapshot({userId:'u1',providerAdapter:posted});
  const [after]=await service.transactions('u1');
  assert.equal(refreshed.updatedTransactions,1);
  assert.equal(after.id,before.id);
  assert.equal(after.status,'POSTED');
  assert.equal(after.userCategoryOverride,'coffee');
});

test('expired consent state is persisted while current financial facts are not refreshed',async()=>{
  const store=createMemoryFinanceStore();
  const service=createFinanceService({store});
  const provider=createFixtureFinanceProvider({name:'bank',consentState:'EXPIRED',accounts:[{id:'a1'}],transactions:[{id:'t1',accountId:'a1',amount:-10,bookedAt:'2026-09-19T10:00:00Z'}]});
  await assert.rejects(service.importProviderSnapshot({userId:'u1',providerAdapter:provider}),(e)=>e.code==='CONSENT_EXPIRED');
  const connection=await store.getConnection('bank:u1');
  assert.equal(connection.consentState,'EXPIRED');
  assert.equal((await store.listAccounts({userId:'u1'})).length,0);
});

test('provider errors never surface or persist raw provider secrets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-finance-private-'));
  try{
    const store=createFileFinanceStore({rootDir:dir});
    const service=createFinanceService({store});
    const provider=createFixtureFinanceProvider({name:'down',failWith:{code:'AUTH_FAILED',message:'Bearer super-secret',retryable:false}});
    provider.apiToken='another-secret';
    await assert.rejects(service.importProviderSnapshot({userId:'u1',providerAdapter:provider}),(e)=>e.code==='AUTH_FAILED'&&e.message==='finance provider failed');
    const text=await readFile(store.path,'utf8').catch(()=> '');
    assert.equal(text.includes('super-secret'),false);
    assert.equal(text.includes('another-secret'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('spending change compares current and previous month deterministically',async()=>{
  const store=createMemoryFinanceStore();let id=0;
  const service=createFinanceService({store,idFactory:()=>`tx-${++id}`,now:()=> '2026-09-19T12:00:00Z'});
  const provider=createFixtureFinanceProvider({name:'bank',accounts:[{id:'a1'}],transactions:[
    {id:'aug-1',accountId:'a1',amount:-100,bookedAt:'2026-08-10T10:00:00Z',status:'POSTED',category:'restaurants'},
    {id:'sep-1',accountId:'a1',amount:-150,bookedAt:'2026-09-10T10:00:00Z',status:'POSTED',category:'restaurants'},
  ]});
  await service.importProviderSnapshot({userId:'u1',providerAdapter:provider});
  const result=await service.spendingChange({userId:'u1',month:'2026-09',category:'restaurants'});
  assert.deepEqual(result,{category:'restaurants',currentMonth:'2026-09',previousMonth:'2026-08',current:150,previous:100,delta:50,percent:50,interpretation:'INCREASE'});
});

test('spending change avoids fabricated percentage when previous baseline is zero',async()=>{
  const service=createFinanceService();
  const result=await service.spendingChange({userId:'u1',month:'2026-09',previousMonth:'2026-08',category:'restaurants'});
  assert.equal(result.previous,0);
  assert.equal(result.percent,null);
  assert.equal(result.interpretation,'NO_PREVIOUS_BASELINE');
});

test('recurring expense detection requires repeated posted outflows with qualifying cadence',async()=>{
  const store=createMemoryFinanceStore();let id=0;
  const service=createFinanceService({store,idFactory:()=>`tx-${++id}`});
  const provider=createFixtureFinanceProvider({name:'bank',accounts:[{id:'a1'}],transactions:[
    {id:'r1',accountId:'a1',amount:-49.9,bookedAt:'2026-06-05T10:00:00Z',status:'POSTED',merchant:'StreamCo',category:'subscriptions'},
    {id:'r2',accountId:'a1',amount:-49.9,bookedAt:'2026-07-05T10:00:00Z',status:'POSTED',merchant:'StreamCo',category:'subscriptions'},
    {id:'r3',accountId:'a1',amount:-49.9,bookedAt:'2026-08-05T10:00:00Z',status:'POSTED',merchant:'StreamCo',category:'subscriptions'},
    {id:'noise',accountId:'a1',amount:-500,bookedAt:'2026-08-06T10:00:00Z',status:'POSTED',merchant:'Store',category:'shopping'},
  ]});
  await service.importProviderSnapshot({userId:'u1',providerAdapter:provider});
  const recurring=await service.recurringExpenses({userId:'u1'});
  assert.equal(recurring.length,1);
  assert.equal(recurring[0].merchant,'StreamCo');
  assert.equal(recurring[0].occurrences,3);
  assert.equal(recurring[0].confidence,'HIGH');
  assert.equal(recurring[0].factType,'INFERRED_RECURRING_PATTERN');
  assert.equal(recurring[0].evidenceTransactionIds.length,3);
});

test('recurring pattern respects user category override while preserving provider fact',async()=>{
  const store=createMemoryFinanceStore();let id=0;
  const service=createFinanceService({store,idFactory:()=>`tx-${++id}`});
  const provider=createFixtureFinanceProvider({name:'bank',accounts:[{id:'a1'}],transactions:[
    {id:'r1',accountId:'a1',amount:-20,bookedAt:'2026-07-01T10:00:00Z',status:'POSTED',merchant:'Club',category:'other'},
    {id:'r2',accountId:'a1',amount:-20,bookedAt:'2026-08-01T10:00:00Z',status:'POSTED',merchant:'Club',category:'other'},
  ]});
  await service.importProviderSnapshot({userId:'u1',providerAdapter:provider});
  const txs=await service.transactions('u1');
  for(const tx of txs) await service.correctCategory(tx.id,'subscriptions');
  const recurring=await service.recurringExpenses({userId:'u1'});
  assert.equal(recurring[0].category,'subscriptions');
  const persisted=await service.transactions('u1');
  assert.ok(persisted.every(tx=>tx.providerCategory==='other'&&tx.userCategoryOverride==='subscriptions'));
});

test('finance insight capabilities route through existing NaIA intent planner rules',()=>{
  const {service}=fixtures();const definitions=[];
  const naia={registerCapability(def){definitions.push(def);return {name:def.name,risk:def.tool.risk};}};
  const registered=registerFinanceCapabilities(naia,{service,userId:'u1'});
  assert.ok(registered.some(row=>row.name==='finance.spendingChange'));
  assert.ok(registered.some(row=>row.name==='finance.recurring'));
  const trend=definitions.find(def=>def.name==='finance.spendingChange');
  assert.equal(trend.rule.match({title:'Onde meu gasto aumentou em relação ao mês passado?'}),true);
  assert.equal(trend.rule.action({title:'x'}).requiresApproval,true);
  const recurring=definitions.find(def=>def.name==='finance.recurring');
  assert.equal(recurring.rule.match({title:'Quais são meus gastos recorrentes?'}),true);
});
