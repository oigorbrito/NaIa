import assert from 'node:assert/strict';
import test from 'node:test';
import { createBelvoFinanceProvider } from '../../src/product/belvo-finance-provider.mjs';
import { createFinanceService } from '../../src/product/finance.mjs';

function jsonResponse(body,status=200){return {ok:status>=200&&status<300,status,async json(){return structuredClone(body);}};}

test('Belvo provider maps accounts, balances and transactions into NaIA finance snapshot',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const u=String(url);requests.push({url:u,options});
    if(u.includes('/api/accounts/'))return jsonResponse({results:[{
      id:'a1',
      institution:{name:'Mockbank'},
      category:'CHECKING_ACCOUNT',
      currency:'BRL',
      balance:{available:'500.25',current:'480.00'},
    }],next:null});
    if(u.includes('/api/transactions/'))return jsonResponse({results:[
      {id:'t1',account:{id:'a1'},amount:'120.50',currency:'BRL',type:'OUTFLOW',status:'PROCESSED',value_date:'2026-09-18',description:'Restaurant',category:'Food'},
      {id:'t2',account:{id:'a1'},amount:'1000.00',currency:'BRL',type:'INFLOW',status:'PENDING',value_date:'2026-09-19',description:'Salary'},
    ],next:null});
    throw new Error('unexpected '+u);
  };
  const provider=createBelvoFinanceProvider({secretId:'id-secret',secretPassword:'pw-secret',linkId:'link-1',fetchImpl});
  const snapshot=await provider.snapshot();
  assert.equal(snapshot.consentState,'ACTIVE');
  assert.deepEqual(snapshot.accounts,[{id:'a1',institution:'Mockbank',type:'CHECKING_ACCOUNT',currency:'BRL'}]);
  assert.deepEqual(snapshot.balances,{a1:500.25});
  assert.equal(snapshot.transactions[0].amount,-120.5);
  assert.equal(snapshot.transactions[0].status,'POSTED');
  assert.equal(snapshot.transactions[1].amount,1000);
  assert.equal(snapshot.transactions[1].status,'PENDING');
  assert.equal(JSON.stringify(snapshot).includes('id-secret'),false);
  assert.equal(JSON.stringify(snapshot).includes('pw-secret'),false);
  const expected='Basic '+Buffer.from('id-secret:pw-secret').toString('base64');
  assert.ok(requests.every((r)=>r.options.headers.authorization===expected));
});

test('Belvo provider follows same-origin pagination and preserves link filter',async()=>{
  const seen=[];
  const fetchImpl=async(url)=>{
    const u=String(url);seen.push(u);
    if(u.includes('/api/accounts/'))return jsonResponse({results:[],next:null});
    if(u.includes('/api/transactions/')&&u.includes('page=2'))return jsonResponse({results:[{id:'t2',account:{id:'a1'},amount:'1',type:'OUTFLOW',status:'PROCESSED',value_date:'2026-09-19'}],next:null});
    if(u.includes('/api/transactions/'))return jsonResponse({results:[{id:'t1',account:{id:'a1'},amount:'2',type:'OUTFLOW',status:'PROCESSED',value_date:'2026-09-18'}],next:'https://api.belvo.com/api/transactions/?link=link-1&page=2'});
    throw new Error('unexpected '+u);
  };
  const provider=createBelvoFinanceProvider({secretId:'a',secretPassword:'b',linkId:'link-1',fetchImpl});
  const snapshot=await provider.snapshot();
  assert.equal(snapshot.transactions.length,2);
  assert.ok(seen.some((u)=>u.includes('link=link-1')));
  assert.ok(seen.some((u)=>u.includes('page=2')));
});

test('Belvo pagination refuses cross-origin next URL before forwarding Basic credentials',async()=>{
  const fetchImpl=async(url)=>{
    const u=String(url);
    if(u.includes('/api/accounts/'))return jsonResponse({results:[],next:null});
    return jsonResponse({results:[],next:'https://evil.example/steal'});
  };
  const provider=createBelvoFinanceProvider({secretId:'a',secretPassword:'b',linkId:'link-1',fetchImpl});
  await assert.rejects(provider.snapshot(),(error)=>error.code==='REDIRECT_BLOCKED');
});

test('Belvo provider composes with existing finance import/idempotency semantics',async()=>{
  const fetchImpl=async(url)=>{
    const u=String(url);
    if(u.includes('/api/accounts/'))return jsonResponse({results:[{id:'a1',institution:{name:'Bank'},category:'CHECKING_ACCOUNT',currency:'BRL',balance:{available:'500'}}],next:null});
    return jsonResponse({results:[{id:'t1',account:{id:'a1'},amount:'100',currency:'BRL',type:'OUTFLOW',status:'PROCESSED',value_date:'2026-09-18',description:'Dinner'}],next:null});
  };
  const provider=createBelvoFinanceProvider({secretId:'a',secretPassword:'b',linkId:'link-1',fetchImpl});
  let id=0;
  const service=createFinanceService({idFactory:()=> 'tx-'+(++id)});
  const first=await service.importProviderSnapshot({userId:'u1',providerAdapter:provider});
  const second=await service.importProviderSnapshot({userId:'u1',providerAdapter:provider});
  assert.equal(first.importedTransactions,1);
  assert.equal(second.duplicateTransactions,1);
  assert.deepEqual((await service.balances('u1')).totals,{BRL:500});
  assert.equal((await service.spending({userId:'u1',month:'2026-09'})).amount,100);
});

test('non-active consent fails through existing finance consent state without any provider HTTP calls',async()=>{
  let calls=0;
  const provider=createBelvoFinanceProvider({secretId:'a',secretPassword:'b',linkId:'link-1',consentState:'REVOKED',fetchImpl:async()=>{calls+=1;return jsonResponse({});}});
  const service=createFinanceService();
  await assert.rejects(service.importProviderSnapshot({userId:'u1',providerAdapter:provider}),(error)=>error.code==='CONSENT_REVOKED');
  assert.equal(calls,0);
});

test('Belvo rate limits normalize as retryable credential-safe finance provider failures',async()=>{
  const provider=createBelvoFinanceProvider({secretId:'secret-id',secretPassword:'secret-pw',linkId:'link-1',fetchImpl:async()=>jsonResponse({},429)});
  const service=createFinanceService();
  await assert.rejects(
    service.importProviderSnapshot({userId:'u1',providerAdapter:provider}),
    (error)=>error.code==='RATE_LIMITED'&&error.retryable===true&&error.message.includes('secret')===false,
  );
});
