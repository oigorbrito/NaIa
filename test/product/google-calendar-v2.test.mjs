import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createGoogleCalendarProvider } from '../../src/product/google-calendar.mjs';

async function withServer(handler,fn){
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();const base=`http://127.0.0.1:${address.port}`;
  try{await fn(base);}finally{server.close();await once(server,'close');}
}
async function readJson(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):null;}

test('Google Calendar list uses bounded Google query shape and normalizes events',async()=>{
  let seen=null;
  await withServer((req,res)=>{seen={url:req.url,auth:req.headers.authorization};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({items:[{id:'e1',summary:'Planning',start:{dateTime:'2026-09-20T10:00:00Z'},end:{dateTime:'2026-09-20T11:00:00Z'},status:'confirmed'}]}));},async(base)=>{
    const provider=createGoogleCalendarProvider({accessToken:'secret-token',apiBaseUrl:base});
    const result=await provider.run('list',{from:'2026-09-20T00:00:00Z',to:'2026-09-21T00:00:00Z'});
    const url=new URL(seen.url,base);
    assert.equal(url.pathname,'/calendar/v3/calendars/primary/events');
    assert.equal(url.searchParams.get('timeMin'),'2026-09-20T00:00:00Z');
    assert.equal(url.searchParams.get('timeMax'),'2026-09-21T00:00:00Z');
    assert.equal(url.searchParams.get('singleEvents'),'true');
    assert.equal(url.searchParams.get('orderBy'),'startTime');
    assert.equal(seen.auth,'Bearer secret-token');
    assert.deepEqual(result.events,[{id:'e1',title:'Planning',start:'2026-09-20T10:00:00Z',end:'2026-09-20T11:00:00Z',status:'confirmed',htmlLink:null}]);
    assert.equal(JSON.stringify(result).includes('secret-token'),false);
  });
});

test('Google Calendar create/update map current NaIA fields to Google bodies',async()=>{
  const seen=[];
  await withServer(async(req,res)=>{const body=await readJson(req);seen.push({method:req.method,url:req.url,body});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:req.method==='POST'?'created':'evt/a b',summary:body.summary,start:body.start,end:body.end}));},async(base)=>{
    const provider=createGoogleCalendarProvider({accessToken:'token',apiBaseUrl:base});
    const created=await provider.run('create',{title:'Dentist',start:'2026-09-20T10:00:00Z',end:'2026-09-20T11:00:00Z'});
    assert.equal(created.event.id,'created');
    await provider.run('update',{eventId:'evt/a b',changes:{title:'Review',start:'2026-09-20T12:00:00Z',end:'2026-09-20T13:00:00Z'}});
    assert.equal(seen[0].method,'POST');
    assert.equal(seen[1].method,'PATCH');
    assert.equal(seen[1].url,'/calendar/v3/calendars/primary/events/evt%2Fa%20b');
    assert.equal(seen[1].body.summary,'Review');
  });
});

test('Google Calendar provider requires token and never serializes it',()=>{
  assert.throws(()=>createGoogleCalendarProvider({accessToken:''}),/access token is required/i);
  const provider=createGoogleCalendarProvider({accessToken:'do-not-expose',fetchImpl:async()=>{throw new Error('unused');}});
  assert.equal(JSON.stringify(provider).includes('do-not-expose'),false);
});

test('Google Calendar 429/5xx are retryable while auth/404 are permanent',async()=>{
  for(const [status,retryable] of [[429,true],[503,true],[401,false],[404,false]]){
    await withServer((req,res)=>{res.writeHead(status,{'content-type':'application/json'});res.end('{}');},async(base)=>{
      const provider=createGoogleCalendarProvider({accessToken:'token',apiBaseUrl:base});
      await assert.rejects(provider.run('list',{from:'2026-09-20T00:00:00Z',to:'2026-09-21T00:00:00Z'}),(error)=>error.retryable===retryable&&error.code===`HTTP_${status}`);
    });
  }
});

test('Google Calendar redirects fail closed and response size is bounded',async()=>{
  await withServer((req,res)=>{res.writeHead(302,{location:'https://evil.example'});res.end();},async(base)=>{
    const provider=createGoogleCalendarProvider({accessToken:'token',apiBaseUrl:base});
    await assert.rejects(provider.run('list',{from:'2026-09-20T00:00:00Z',to:'2026-09-21T00:00:00Z'}),/redirects are not allowed/);
  });
  await withServer((req,res)=>{const body=JSON.stringify({items:[{id:'x',summary:'x'.repeat(1000)}]});res.writeHead(200,{'content-type':'application/json','content-length':String(Buffer.byteLength(body))});res.end(body);},async(base)=>{
    const provider=createGoogleCalendarProvider({accessToken:'token',apiBaseUrl:base,maxBytes:100});
    await assert.rejects(provider.run('list',{from:'2026-09-20T00:00:00Z',to:'2026-09-21T00:00:00Z'}),/exceeds maxBytes/);
  });
});

test('Google Calendar timeout is retryable and never becomes success',async()=>{
  await withServer((req,res)=>{setTimeout(()=>{if(!res.writableEnded){res.writeHead(200,{'content-type':'application/json'});res.end('{"items":[]}');}},100);},async(base)=>{
    const provider=createGoogleCalendarProvider({accessToken:'token',apiBaseUrl:base,timeoutMs:10});
    await assert.rejects(provider.run('list',{from:'2026-09-20T00:00:00Z',to:'2026-09-21T00:00:00Z'}),(error)=>error.code==='TIMEOUT'&&error.retryable===true);
  });
});
