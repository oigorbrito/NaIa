import assert from 'node:assert/strict';
import test from 'node:test';
import { createNaiaService } from '../../src/product/service.mjs';
import { createInMemoryPorts } from '../../src/product/ports.mjs';
import {
  createFixtureMessagingProvider,
  createMessagingService,
  registerMessagingCapabilities,
} from '../../src/product/messaging.mjs';

function makeClock(initial='2026-09-19T14:00:00Z'){let current=initial;return {now:()=>current,set:(value)=>{current=value;}};}

test('WhatsApp-style conversation summary surfaces urgent and pending-reply state',async()=>{
  const provider=createFixtureMessagingProvider({name:'whatsapp',messages:[
    {id:'m1',conversationId:'family',direction:'INBOUND',text:'Urgente: compra o remédio hoje',timestamp:'2026-09-19T12:00:00Z'},
    {id:'m2',conversationId:'family',direction:'INBOUND',text:'Me avisa quando der',timestamp:'2026-09-19T12:05:00Z'},
  ]});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'WHATSAPP',provider,scopes:['messages.read','messages.send'],credentialRef:'secure://whatsapp/u1'});
  const result=await service.conversation({sessionId:session.id,conversationId:'family'});
  assert.equal(result.summary.messageCount,2);
  assert.equal(result.summary.urgentCount,1);
  assert.equal(result.summary.pendingReply,true);
  assert.equal(result.summary.actionItems[0].messageId,'m1');
});

test('Slack-style search only sees connected adapter content with read scope',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack',messages:[
    {id:'s1',conversationId:'eng',direction:'INBOUND',text:'deploy blocked by CI',timestamp:'2026-09-19T12:00:00Z'},
    {id:'s2',conversationId:'sales',direction:'INBOUND',text:'pipeline green',timestamp:'2026-09-19T12:10:00Z'},
  ]});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.read'],credentialRef:'secure://slack/u1'});
  const result=await service.search({sessionId:session.id,query:'blocked'});
  assert.deepEqual(result.messages.map(m=>m.id),['s1']);
});

test('missing connector scope fails explicitly',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack'});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.read']});
  await assert.rejects(
    service.send({sessionId:session.id,conversationId:'eng',text:'hello',idempotencyKey:'x'}),
    (error)=>error.code==='INSUFFICIENT_SCOPE'&&error.scope==='messages.send',
  );
});

test('connector state never persists raw provider token',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack',token:'super-secret-token'});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.read'],credentialRef:'secure://slack/u1'});
  const persisted=await service.session(session.id);
  assert.equal(JSON.stringify(persisted).includes('super-secret-token'),false);
  assert.equal(persisted.credentialRef,'secure://slack/u1');
});

test('revoking connector immediately prevents future calls',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack',messages:[{id:'s1',conversationId:'eng',text:'hello'}]});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.read','messages.send']});
  await service.revoke(session.id);
  await assert.rejects(service.search({sessionId:session.id,query:'hello'}),(error)=>error.code==='REVOKED');
  await assert.rejects(service.send({sessionId:session.id,conversationId:'eng',text:'x',idempotencyKey:'after-revoke'}),(error)=>error.code==='REVOKED');
});

test('draft reply does not send anything',async()=>{
  const provider=createFixtureMessagingProvider({name:'whatsapp'});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'WHATSAPP',provider,scopes:['messages.read','messages.send']});
  const draft=await service.draft({sessionId:session.id,conversationId:'c1',text:'Vou verificar e te respondo.',replyTo:'m1'});
  assert.equal(draft.conversationId,'c1');
  assert.equal(provider.sent().length,0);
});

test('registered outbound send is blocked by runtime until explicit approval',async()=>{
  const provider=createFixtureMessagingProvider({name:'whatsapp'});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'WHATSAPP',provider,scopes:['messages.read','messages.send']});
  const naia=createNaiaService(createInMemoryPorts());
  registerMessagingCapabilities(naia,{service,sessionId:session.id,prefix:'whatsapp'});
  const objective=await naia.pursueAction({title:'Send WhatsApp reply',action:{tool:'whatsapp.send',input:{conversationId:'c1',text:'Oi',idempotencyKey:'send-1'},risk:'EXTERNAL_WRITE',requiresApproval:true}});
  assert.equal(objective.objective.status,'WAITING_APPROVAL');
  assert.equal(provider.sent().length,0);
  const completed=await naia.approve(objective.objective.id,'whatsapp.send');
  assert.equal(completed.objective.status,'COMPLETED');
  assert.equal(provider.sent().length,1);
});

test('approved send is idempotent across duplicate execution key',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack'});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.send']});
  const first=await service.send({sessionId:session.id,conversationId:'eng',text:'hello',idempotencyKey:'same-send'});
  const duplicate=await service.send({sessionId:session.id,conversationId:'eng',text:'hello',idempotencyKey:'same-send'});
  assert.equal(first.duplicate,false);
  assert.equal(duplicate.duplicate,true);
  assert.equal(provider.sent().length,1);
});

test('scheduled outbound message is approval-gated at creation, not sent before due time, and fires once',async()=>{
  const clock=makeClock();
  const provider=createFixtureMessagingProvider({name:'whatsapp'});
  let id=0;
  const service=createMessagingService({idFactory:()=> 'id-'+(++id),now:clock.now});
  const session=await service.connect({userId:'u1',kind:'WHATSAPP',provider,scopes:['messages.send']});
  const naia=createNaiaService(createInMemoryPorts());
  registerMessagingCapabilities(naia,{service,sessionId:session.id,prefix:'whatsapp'});
  const proposed=await naia.pursueAction({title:'Schedule WhatsApp',action:{tool:'whatsapp.schedule',input:{conversationId:'c1',text:'Bom dia',sendAt:'2026-09-20T09:00:00Z'},risk:'EXTERNAL_WRITE',requiresApproval:true}});
  assert.equal(proposed.objective.status,'WAITING_APPROVAL');
  assert.equal((await service.listSchedules(session.id)).length,0);
  await naia.approve(proposed.objective.id,'whatsapp.schedule');
  const schedule=(await service.listSchedules(session.id))[0];
  assert.ok(schedule.approvedAt);
  assert.equal(provider.sent().length,0);
  const early=await service.deliverScheduled(schedule.id,{occurrenceKey:'2026-09-20'});
  assert.equal(early.reason,'not-due');
  clock.set('2026-09-20T09:00:00Z');
  const due=await service.deliverScheduled(schedule.id,{occurrenceKey:'2026-09-20'});
  assert.equal(due.delivered,true);
  assert.equal(provider.sent().length,1);
  const duplicate=await service.deliverScheduled(schedule.id,{occurrenceKey:'different-trigger'});
  assert.equal(duplicate.reason,'already-delivered');
  assert.equal(provider.sent().length,1);
});

test('provider send failure remains explicit and retryable without fake success',async()=>{
  const provider=createFixtureMessagingProvider({name:'slack',failSend:{code:'RATE_LIMITED',message:'429',retryable:true}});
  const service=createMessagingService();
  const session=await service.connect({userId:'u1',kind:'SLACK',provider,scopes:['messages.send']});
  await assert.rejects(
    service.send({sessionId:session.id,conversationId:'eng',text:'hello',idempotencyKey:'fail'}),
    (error)=>error.code==='RATE_LIMITED'&&error.retryable===true,
  );
  assert.equal(provider.sent().length,0);
});
