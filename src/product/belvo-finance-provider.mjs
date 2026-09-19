import { Buffer } from 'node:buffer';

function clone(v){return v==null?v:structuredClone(v);}

function belvoError(status){
  const e=new Error('Belvo API request failed');
  if(status===401){e.code='AUTH_FAILED';e.retryable=false;}
  else if(status===403){e.code='PERMISSION_DENIED';e.retryable=false;}
  else if(status===404){e.code='NOT_FOUND';e.retryable=false;}
  else if(status===408){e.code='TIMEOUT';e.retryable=true;}
  else if(status===429){e.code='RATE_LIMITED';e.retryable=true;}
  else if(status===428){e.code='CONSENT_INTERACTION_REQUIRED';e.retryable=false;}
  else if(status>=500){e.code='PROVIDER_UNAVAILABLE';e.retryable=true;}
  else {e.code='PROVIDER_ERROR';e.retryable=false;}
  e.status=status;
  return e;
}

async function getJson({url,secretId,secretPassword,fetchImpl=globalThis.fetch}){
  if(!secretId||!secretPassword)throw new Error('Belvo API credentials are required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  const auth=Buffer.from(String(secretId)+':'+String(secretPassword),'utf8').toString('base64');
  const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json',authorization:'Basic '+auth},redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const e=new Error('Belvo redirects are not allowed');e.code='REDIRECT_BLOCKED';e.retryable=false;throw e;}
  if(!response.ok)throw belvoError(response.status);
  return response.json();
}

async function listAll({baseUrl,path,linkId,secretId,secretPassword,fetchImpl,pageSize=1000}){
  const root=String(baseUrl).replace(/\/$/,'');
  let url=new URL(root+path);
  url.searchParams.set('link',String(linkId));
  url.searchParams.set('page_size',String(Math.min(Math.max(Number(pageSize)||1,1),1000)));
  const rows=[];
  const origin=url.origin;
  while(url){
    const page=await getJson({url,secretId,secretPassword,fetchImpl});
    rows.push(...(page?.results??[]));
    if(!page?.next)break;
    const next=new URL(page.next);
    if(next.origin!==origin){const e=new Error('Belvo pagination escaped configured origin');e.code='REDIRECT_BLOCKED';e.retryable=false;throw e;}
    url=next;
  }
  return rows;
}

function normalizeAccount(raw){
  const balance=raw?.balance??{};
  return {
    id:String(raw?.id??''),
    institution:raw?.institution?.name??raw?.institution?.display_name??raw?.institution??null,
    type:raw?.category??raw?.type??'UNKNOWN',
    currency:raw?.currency??'BRL',
    balance:Number.isFinite(Number(balance?.available))?Number(balance.available):Number.isFinite(Number(balance?.current))?Number(balance.current):null,
  };
}

function normalizeTransaction(raw){
  const magnitude=Number(raw?.amount);
  const direction=String(raw?.type??raw?.transaction_type??'').toUpperCase();
  const signed=Number.isFinite(magnitude)?(direction==='OUTFLOW'?-Math.abs(magnitude):direction==='INFLOW'?Math.abs(magnitude):magnitude):NaN;
  const status=String(raw?.status??'PROCESSED').toUpperCase()==='PENDING'?'PENDING':'POSTED';
  const accountId=raw?.account?.id??raw?.account??null;
  return {
    id:String(raw?.id??''),
    accountId:String(accountId??''),
    amount:signed,
    currency:raw?.currency??raw?.account?.currency??'BRL',
    bookedAt:raw?.value_date??raw?.accounting_date??raw?.created_at??raw?.collected_at??null,
    merchant:raw?.merchant?.name??raw?.merchant??null,
    description:raw?.description??null,
    status,
    category:raw?.category??null,
  };
}

export function createBelvoFinanceProvider({
  secretId,
  secretPassword,
  linkId,
  consentState='ACTIVE',
  apiBaseUrl='https://api.belvo.com',
  fetchImpl=globalThis.fetch,
  pageSize=1000,
}={}){
  if(!linkId)throw new Error('Belvo linkId is required');
  return {
    name:'belvo',
    async snapshot(){
      if(consentState!=='ACTIVE')return {consentState,accounts:[],transactions:[],balances:{}};
      const [accountRows,transactionRows]=await Promise.all([
        listAll({baseUrl:apiBaseUrl,path:'/api/accounts/',linkId,secretId,secretPassword,fetchImpl,pageSize}),
        listAll({baseUrl:apiBaseUrl,path:'/api/transactions/',linkId,secretId,secretPassword,fetchImpl,pageSize}),
      ]);
      const accounts=accountRows.map(normalizeAccount).filter((row)=>row.id);
      const balances={};
      for(const account of accounts)if(Number.isFinite(account.balance))balances[account.id]=account.balance;
      const transactions=transactionRows.map(normalizeTransaction).filter((row)=>row.id&&row.accountId&&Number.isFinite(row.amount)&&row.bookedAt);
      return {
        consentState:'ACTIVE',
        accounts:accounts.map(({balance,...rest})=>rest),
        balances,
        transactions,
        coverage:{provider:'belvo',linkId:String(linkId),accounts:accounts.length,transactions:transactions.length},
      };
    },
  };
}
