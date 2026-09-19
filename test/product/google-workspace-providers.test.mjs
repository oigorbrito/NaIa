import assert from 'node:assert/strict';
import test from 'node:test';
import { createGmailProvider, createGoogleDriveProvider } from '../../src/product/google-workspace-providers.mjs';
import { createEmailService } from '../../src/product/email.mjs';
import { createDriveService } from '../../src/product/google-drive.mjs';

function jsonResponse(body,status=200){
  return {ok:status>=200&&status<300,status,async json(){return structuredClone(body);},async text(){return typeof body==='string'?body:JSON.stringify(body);}};
}

test('Gmail provider lists metadata, reads body, sends RFC message and never returns OAuth token',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const u=String(url);requests.push({url:u,options});
    if(u.includes('/messages?')){
      return jsonResponse({messages:[{id:'m1'}]});
    }
    if(u.includes('/messages/m1')&&u.includes('format=metadata')){
      return jsonResponse({id:'m1',threadId:'t1',snippet:'hello',payload:{headers:[
        {name:'From',value:'a@example.com'},{name:'To',value:'u@example.com'},{name:'Subject',value:'Invoice'},{name:'Date',value:'today'},
      ]}});
    }
    if(u.includes('/messages/m1')&&u.includes('format=full')){
      return jsonResponse({id:'m1',threadId:'t1',payload:{headers:[
        {name:'From',value:'a@example.com'},{name:'To',value:'u@example.com'},{name:'Subject',value:'Invoice'},
      ],mimeType:'text/plain',body:{data:Buffer.from('Body text').toString('base64url')}}});
    }
    if(u.endsWith('/messages/send'))return jsonResponse({id:'sent1',threadId:'t2'});
    throw new Error('unexpected URL '+u);
  };
  const provider=createGmailProvider({accessToken:'gmail-secret',fetchImpl});
  const service=createEmailService();
  const search=await service.search({provider,query:'invoice'});
  assert.equal(search.messages[0].subject,'Invoice');
  const read=await service.read({provider,messageId:'m1'});
  assert.equal(read.message.body,'Body text');
  const send=await service.send({provider,to:'x@example.com',subject:'Hi',body:'Hello',idempotencyKey:'k1'});
  assert.equal(send.message.id,'sent1');
  const sentRequest=requests.find((r)=>r.url.endsWith('/messages/send'));
  const encoded=JSON.parse(sentRequest.options.body).raw;
  const decoded=Buffer.from(encoded,'base64url').toString('utf8');
  assert.match(decoded,/To: x@example\.com/);
  assert.match(decoded,/Subject: Hi/);
  assert.match(decoded,/Hello/);
  assert.equal(JSON.stringify({search,read,send}).includes('gmail-secret'),false);
  assert.ok(requests.every((r)=>r.options.headers.authorization==='Bearer gmail-secret'));
});

test('Gmail provider normalizes retryable rate limit without leaking provider body',async()=>{
  const provider=createGmailProvider({accessToken:'secret',fetchImpl:async()=>jsonResponse({error:{message:'Bearer secret'}},429)});
  await assert.rejects(provider.search({query:'x'}),(error)=>error.code==='RATE_LIMITED'&&error.retryable===true&&error.message.includes('secret')===false);
});

test('Google Drive provider satisfies existing connect/search/read contract for text files',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const u=String(url);requests.push({url:u,options});
    if(u.includes('/drive/v3/files?'))return jsonResponse({files:[{id:'f1',name:'Notes',mimeType:'text/plain',modifiedTime:'2026-09-19T00:00:00Z',size:'12',webViewLink:'https://drive.google.com/f1'}]});
    if(u.includes('/drive/v3/files/f1?fields='))return jsonResponse({id:'f1',name:'Notes',mimeType:'text/plain',modifiedTime:'2026-09-19T00:00:00Z',size:'12',webViewLink:'https://drive.google.com/f1',capabilities:{canDownload:true}});
    if(u.includes('/drive/v3/files/f1?alt=media'))return jsonResponse('hello drive');
    throw new Error('unexpected URL '+u);
  };
  const provider=createGoogleDriveProvider({accessToken:'drive-secret',fetchImpl});
  const service=createDriveService();
  const connected=await service.connect({userId:'u1',provider,credentialRef:'secure://drive/u1'});
  assert.equal(connected.status,'CONNECTED');
  const search=await service.search({userId:'u1',provider,query:'Notes'});
  assert.equal(search.files[0].id,'f1');
  const read=await service.read({userId:'u1',provider,fileId:'f1'});
  assert.equal(read.file.content,'hello drive');
  assert.equal(JSON.stringify({connected,search,read}).includes('drive-secret'),false);
  assert.ok(requests.every((r)=>r.options.headers.authorization==='Bearer drive-secret'));
});

test('Google Drive provider exports supported Workspace docs instead of pretending blob download works',async()=>{
  let exportUrl='';
  const fetchImpl=async(url)=>{
    const u=String(url);
    if(u.includes('/drive/v3/files/doc1?fields='))return jsonResponse({id:'doc1',name:'Doc',mimeType:'application/vnd.google-apps.document',capabilities:{canDownload:true}});
    if(u.includes('/drive/v3/files/doc1/export?')){exportUrl=u;return jsonResponse('exported text');}
    throw new Error('unexpected URL '+u);
  };
  const provider=createGoogleDriveProvider({accessToken:'x',fetchImpl});
  const file=await provider.read({fileId:'doc1'});
  assert.equal(file.content,'exported text');
  assert.match(exportUrl,/mimeType=text%2Fplain/);
});

test('Google Drive provider blocks unsupported binary reads explicitly',async()=>{
  const provider=createGoogleDriveProvider({
    accessToken:'x',
    fetchImpl:async()=>jsonResponse({id:'pdf1',name:'PDF',mimeType:'application/pdf',capabilities:{canDownload:true}}),
  });
  await assert.rejects(provider.read({fileId:'pdf1'}),(error)=>error.code==='UNSUPPORTED_MIME'&&error.retryable===false);
});

test('Google Workspace providers reject redirects instead of forwarding bearer credentials',async()=>{
  const provider=createGmailProvider({accessToken:'secret',fetchImpl:async()=>jsonResponse({},302)});
  await assert.rejects(provider.search({query:'x'}),(error)=>error.code==='REDIRECT_BLOCKED');
});
