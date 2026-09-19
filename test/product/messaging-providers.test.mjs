import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryWhatsAppWebhookStore,
  createSlackMessagingProvider,
  createWhatsAppCloudMessagingProvider,
  parseWhatsAppWebhook,
} from '../../src/product/messaging-providers.mjs';
import { createMessagingService } from '../../src/product/messaging.mjs';

function jsonResponse(body,status=200){return {ok:status>=200&&status<300,status,async json(){return structuredClone(body);}};}

test('Slack provider maps search, history and postMessage into messaging contract',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const u=String(url);requests.push({url:u,options});
    if(u.includes('/search.messages?'))return jsonResponse({ok:true,messages:{matches:[{ts:'1.1',text:'deploy blocked',user:'U1',channel:{id:'C1'}}]}});
    if(u.includes('/conversations.history?'))return jsonResponse({ok:true,messages:[{ts:'1.2',text:'thread message',user:'U2'}]});
    if(u.endsWith('/chat.postMessage'))return jsonResponse({ok:true,channel:'C1',ts:'1.3',message:{text:'hello',bot_id:'B1'}});
    throw new Error('unexpected '+u);
  };
  const provider=createSlackMessagingProvider({accessToken:'slack-secret',fetchImpl,maxResults:20});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.read','messages.send'],credentialRef:'secure://slack/u1'});
  const search=await service.search({sessionId:session.id,query:'deploy'});
  assert.equal(search.messages[0].conversationId,'C1');
  assert.equal(search.messages[0].text,'deploy blocked');
  const convo=await service.conversation({sessionId:session.id,conversationId:'C1'});
  assert.equal(convo.messages[0].conversationId,'C1');
  const sent=await service.send({sessionId:session.id,conversationId:'C1',text:'hello',idempotencyKey:'slack-1'});
  assert.equal(sent.message.id,'1.3');
  const post=requests.find((r)=>r.url.endsWith('/chat.postMessage'));
  assert.deepEqual(JSON.parse(post.options.body),{channel:'C1',text:'hello'});
  assert.ok(requests.every((r)=>r.options.headers.authorization==='Bearer slack-secret'));
  assert.equal(JSON.stringify({search,convo,sent}).includes('slack-secret'),false);
});

test('Slack provider caps history reads to current conservative page size',async()=>{
  let seen;
  const provider=createSlackMessagingProvider({
    accessToken:'x',
    maxResults:100,
    fetchImpl:async(url)=>{seen=String(url);return jsonResponse({ok:true,messages:[]});},
  });
  await provider.read({conversationId:'C1'});
  assert.match(seen,/limit=15/);
});

test('Slack API logical errors normalize without leaking provider message',async()=>{
  const provider=createSlackMessagingProvider({accessToken:'secret',fetchImpl:async()=>jsonResponse({ok:false,error:'ratelimited'})});
  await assert.rejects(provider.search({query:'x'}),(error)=>error.code==='RATE_LIMITED'&&error.retryable===true&&error.message.includes('secret')===false);
});

test('WhatsApp webhook parser normalizes inbound text messages with source provenance',()=>{
  const payload={entry:[{changes:[{value:{
    metadata:{phone_number_id:'P1'},
    messages:[{id:'wamid.1',from:'5511999999999',timestamp:'1789840800',type:'text',text:{body:'Oi NaIA'}}],
  }}]}]};
  const rows=parseWhatsAppWebhook(payload);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,'wamid.1');
  assert.equal(rows[0].conversationId,'5511999999999');
  assert.equal(rows[0].text,'Oi NaIA');
  assert.equal(rows[0].phoneNumberId,'P1');
  assert.equal(rows[0].source,'whatsapp');
});

test('WhatsApp Cloud provider reads/searches only webhook-ingested events and deduplicates delivery',async()=>{
  const store=createMemoryWhatsAppWebhookStore();
  const provider=createWhatsAppCloudMessagingProvider({accessToken:'wa-secret',phoneNumberId:'P1',webhookStore:store,fetchImpl:async()=>jsonResponse({messages:[{id:'wamid.out'}]})});
  const payload={entry:[{changes:[{value:{metadata:{phone_number_id:'P1'},messages:[
    {id:'wamid.1',from:'5511',timestamp:'1789840800',text:{body:'urgente hoje'}},
    {id:'wamid.2',from:'5522',timestamp:'1789840860',text:{body:'outro'}},
  ]}}]}]};
  const first=await provider.ingestWebhook(payload);
  const duplicate=await provider.ingestWebhook(payload);
  assert.deepEqual(first,{received:2,added:2});
  assert.deepEqual(duplicate,{received:2,added:0});
  assert.equal((await provider.search({query:'urgente'})).length,1);
  assert.equal((await provider.read({conversationId:'5511'})).length,1);
});

test('WhatsApp Cloud provider sends text through Graph messages endpoint and preserves reply context',async()=>{
  let seen;
  const provider=createWhatsAppCloudMessagingProvider({
    accessToken:'wa-secret',
    phoneNumberId:'P123',
    apiVersion:'v23.0',
    fetchImpl:async(url,options)=>{seen={url:String(url),options};return jsonResponse({messaging_product:'whatsapp',messages:[{id:'wamid.out1'}]});},
  });
  const sent=await provider.send({conversationId:'5511999999999',text:'Resposta',replyTo:'wamid.in1'});
  assert.equal(seen.url,'https://graph.facebook.com/v23.0/P123/messages');
  assert.equal(seen.options.headers.authorization,'Bearer wa-secret');
  assert.deepEqual(JSON.parse(seen.options.body),{
    messaging_product:'whatsapp',
    to:'5511999999999',
    type:'text',
    text:{body:'Resposta'},
    context:{message_id:'wamid.in1'},
  });
  assert.equal(sent.id,'wamid.out1');
  assert.equal(JSON.stringify(sent).includes('wa-secret'),false);
});

test('WhatsApp live provider composes with existing approval/idempotent messaging service',async()=>{
  let posts=0;
  const provider=createWhatsAppCloudMessagingProvider({
    accessToken:'x',
    phoneNumberId:'P1',
    fetchImpl:async()=>{posts+=1;return jsonResponse({messages:[{id:'out1'}]});},
  });
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'WHATSAPP',provider,scopes:['messages.send']});
  const first=await service.send({sessionId:session.id,conversationId:'5511',text:'oi',idempotencyKey:'same'});
  const duplicate=await service.send({sessionId:session.id,conversationId:'5511',text:'oi',idempotencyKey:'same'});
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(posts,1);
});

test('revoking live adapters blocks future provider calls before HTTP transport',async()=>{
  let calls=0;
  const provider=createSlackMessagingProvider({accessToken:'x',fetchImpl:async()=>{calls+=1;return jsonResponse({ok:true,messages:{matches:[]}});}});
  provider.revoke();
  await assert.rejects(provider.search({query:'x'}),(error)=>error.code==='REVOKED');
  assert.equal(calls,0);
});

test('live messaging adapters block redirects before forwarding bearer token',async()=>{
  const provider=createSlackMessagingProvider({accessToken:'secret',fetchImpl:async()=>jsonResponse({},302)});
  await assert.rejects(provider.search({query:'x'}),(error)=>error.code==='REDIRECT_BLOCKED');
});
